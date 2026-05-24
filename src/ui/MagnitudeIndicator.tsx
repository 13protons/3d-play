import {
  computeMagnitudeIndicatorClipInset,
  computeMagnitudeIndicatorFill,
  computeMagnitudeIndicatorTone,
} from './magnitudeIndicatorMath'

interface MagnitudeIndicatorProps {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  dangerThreshold?: number
}

export function MagnitudeIndicator({ label, value, min, max, unit, dangerThreshold }: MagnitudeIndicatorProps) {
  const fill = computeMagnitudeIndicatorFill({ value, min, max })
  const tone = computeMagnitudeIndicatorTone({ value, dangerThreshold })
  const fillColor = tone === 'danger' ? '#ff5a52' : '#ffc15f'
  const valueColor = tone === 'danger' ? '#ff8a82' : 'rgba(255,205,112,0.94)'
  const inverseTextColor = '#020308'
  const clipPath = computeMagnitudeIndicatorClipInset(fill)
  const valueText = `${value > 0 ? '+' : ''}${formatMagnitudeValue(value)}`

  return (
    <div
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        width: 180,
        height: 15,
        border: '1px solid rgba(150,230,230,0.42)',
        background: 'rgba(0,10,12,0.6)',
        fontFamily: 'monospace',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      aria-label={`${label} magnitude${unit ? ` in ${unit}` : ''}`}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, transparent calc(50% - 1px), rgba(230,255,255,0.65) calc(50% - 1px), rgba(230,255,255,0.65) 50%, transparent 50%)',
        }}
      />
      {fill.side !== 'zero' && (
        <div
          style={{
            position: 'absolute',
            top: 1,
            bottom: 1,
            left: `${fill.leftPercent}%`,
            width: `${fill.widthPercent}%`,
            background: fillColor,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.16) inset',
          }}
        />
      )}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          paddingLeft: 8,
          color: 'rgba(210,250,255,0.62)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: 'absolute',
          zIndex: 1,
          right: 8,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          color: valueColor,
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {valueText}
      </div>
      {fill.side !== 'zero' && (
        <div
          style={{
            position: 'absolute',
            zIndex: 2,
            inset: 0,
            clipPath,
            color: inverseTextColor,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.8,
          }}
          aria-hidden="true"
        >
          <div style={{ display: 'flex', alignItems: 'center', height: '100%', paddingLeft: 8 }}>{label}</div>
          <div
            style={{
              position: 'absolute',
              right: 8,
              top: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              letterSpacing: 0,
            }}
          >
            {valueText}
          </div>
        </div>
      )}
    </div>
  )
}

function formatMagnitudeValue(value: number) {
  if (!Number.isFinite(value)) return '0.00'
  return value.toFixed(2)
}
