/**
 * GLSL single-scattering atmosphere (Nishita / GPU Gems 2 style), ray-marched
 * per fragment on a planet-centered shell. Scene units are metres, so the
 * per-metre scattering coefficients in the body's atmosphere asset are used
 * directly — no rescale.
 *
 * The shader composites analytically: it intersects the view ray with the
 * planet sphere itself to bound the march, so it scatters correctly over the
 * lit surface (aerial perspective), into the sky overhead, and across the limb
 * against space — without sampling the rendered depth buffer. That's what lets
 * it slot into the existing manual multi-pass renderer as a plain additive pass.
 *
 * VIEW_SAMPLES / LIGHT_SAMPLES are injected as `defines` from the config so the
 * loop bounds stay compile-time constant.
 */

export const ATMOSPHERE_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`

export const ATMOSPHERE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldPosition;

uniform vec3 uPlanetCenter;     // scene-space, relative to floating origin
uniform vec3 uSunDirection;     // unit vector from planet toward the sun
uniform float uPlanetRadius;    // metres
uniform float uAtmosphereRadius;// metres (planetRadius + shellHeight)
uniform vec3 uBetaRayleigh;     // per-metre, RGB
uniform float uBetaMie;         // per-metre
uniform float uRayleighScaleHeight;
uniform float uMieScaleHeight;
uniform float uMieG;            // Henyey-Greenstein anisotropy
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

  // Bound the march at the planet surface so we scatter over terrain, not past it.
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
      if (sunHeight < 0.0) { inShadow = true; break; } // planet blocks the sun
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

  // Exposure tone-map + approximate sRGB so additive compositing reads sensibly
  // over the tone-mapped surface already in the framebuffer.
  color = vec3(1.0) - exp(-color);
  color = pow(color, vec3(1.0 / 2.2));

  gl_FragColor = vec4(color, 1.0);
}
`
