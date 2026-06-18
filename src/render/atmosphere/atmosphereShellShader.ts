/**
 * From-space single-scattering atmosphere shell (Nishita / O'Neil / GPU Gems 2 ch.16,
 * the Sebastian Lague teaching form). Ray-marched per fragment on a planet-centred
 * shell, this renders the planet's atmosphere seen from *outside*: the blue limb, the
 * day-side wash, and the red sunset ring at the terminator (the sun-march `inShadow`
 * test is what carves the terminator). Adapted from the removed v1 shell — which was
 * the right technique in the wrong place (it ran in the in-atmosphere ground view).
 *
 * Scene units are metres, so per-metre scattering coefficients are used directly (the
 * caller converts the takram-native per-km values). The shader bounds the march by
 * intersecting the view ray with the atmosphere shell AND the planet analytically, so
 * the planet occludes its far hemisphere and the limb reads against space — no depth
 * buffer needed. Output is additive HDR (linear); the render pipeline does output
 * encoding, so there is NO sRGB here (the v1 shell's `pow(1/2.2)` would double-encode).
 *
 * VIEW_SAMPLES / LIGHT_SAMPLES are injected as `defines` so the loops stay constant.
 */

export const ATMOSPHERE_SHELL_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`

export const ATMOSPHERE_SHELL_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldPosition;

uniform vec3 uPlanetCenter;      // scene-space, relative to floating origin
uniform vec3 uSunDirection;      // unit vector from planet toward the sun
uniform float uPlanetRadius;     // metres
uniform float uAtmosphereRadius; // metres (planetRadius + shellHeight)
uniform vec3 uBetaRayleigh;      // per-metre, RGB
uniform float uBetaMie;          // per-metre
uniform float uRayleighScaleHeight;
uniform float uMieScaleHeight;
uniform float uMieG;             // Henyey-Greenstein anisotropy
uniform float uSunIntensity;

const float PI = 3.141592653589793;

// Returns (near, far) ray parameters for the sphere, or near > far on a miss.
vec2 raySphere(vec3 origin, vec3 dir, vec3 center, float radius) {
  vec3 oc = origin - center;
  float b = dot(oc, dir);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void main() {
  vec3 rayOrigin = cameraPosition;
  vec3 rayDir = normalize(vWorldPosition - cameraPosition);

  vec2 atmosphereHit = raySphere(rayOrigin, rayDir, uPlanetCenter, uAtmosphereRadius);
  if (atmosphereHit.x > atmosphereHit.y) discard; // ray misses the atmosphere

  float marchStart = max(atmosphereHit.x, 0.0); // 0 when the camera is inside
  float marchEnd = atmosphereHit.y;

  // Bound the march at the planet surface so the planet occludes the far hemisphere.
  vec2 planetHit = raySphere(rayOrigin, rayDir, uPlanetCenter, uPlanetRadius);
  if (planetHit.x > 0.0 && planetHit.x < marchEnd) marchEnd = planetHit.x;
  if (marchEnd <= marchStart) discard;

  float segmentLength = (marchEnd - marchStart) / float(VIEW_SAMPLES);
  float t = marchStart + segmentLength * 0.5;

  vec3 totalRayleigh = vec3(0.0);
  vec3 totalMie = vec3(0.0);
  float opticalDepthR = 0.0;
  float opticalDepthM = 0.0;

  for (int i = 0; i < VIEW_SAMPLES; i++) {
    vec3 samplePos = rayOrigin + rayDir * t;
    float height = max(length(samplePos - uPlanetCenter) - uPlanetRadius, 0.0);

    float densityR = exp(-height / uRayleighScaleHeight) * segmentLength;
    float densityM = exp(-height / uMieScaleHeight) * segmentLength;
    opticalDepthR += densityR;
    opticalDepthM += densityM;

    // March toward the sun to accumulate the light ray's optical depth.
    vec2 sunHit = raySphere(samplePos, uSunDirection, uPlanetCenter, uAtmosphereRadius);
    float sunSegment = sunHit.y / float(LIGHT_SAMPLES);
    float sunT = sunSegment * 0.5;
    float sunOpticalDepthR = 0.0;
    float sunOpticalDepthM = 0.0;
    bool inShadow = false;

    for (int j = 0; j < LIGHT_SAMPLES; j++) {
      vec3 sunSamplePos = samplePos + uSunDirection * sunT;
      float sunHeight = length(sunSamplePos - uPlanetCenter) - uPlanetRadius;
      if (sunHeight < 0.0) { inShadow = true; break; } // planet blocks the sun (terminator/night)
      sunOpticalDepthR += exp(-sunHeight / uRayleighScaleHeight) * sunSegment;
      sunOpticalDepthM += exp(-sunHeight / uMieScaleHeight) * sunSegment;
      sunT += sunSegment;
    }

    if (!inShadow) {
      // Mie extinction ~ 1.1 * scattering (standard approximation).
      vec3 tau = uBetaRayleigh * (opticalDepthR + sunOpticalDepthR)
        + uBetaMie * 1.1 * (opticalDepthM + sunOpticalDepthM);
      vec3 attenuation = exp(-tau);
      totalRayleigh += attenuation * densityR;
      totalMie += attenuation * densityM;
    }

    t += segmentLength;
  }

  float mu = dot(rayDir, uSunDirection);
  float phaseRayleigh = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = uMieG;
  float phaseMie = 3.0 / (8.0 * PI)
    * ((1.0 - g * g) * (1.0 + mu * mu))
    / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

  vec3 color = uSunIntensity
    * (totalRayleigh * uBetaRayleigh * phaseRayleigh
      + totalMie * uBetaMie * phaseMie);

  // Exposure tone-map to keep the HDR inscatter bounded; output stays linear
  // (the render pipeline applies output color encoding).
  color = vec3(1.0) - exp(-color);

  gl_FragColor = vec4(color, 1.0);
}
`
