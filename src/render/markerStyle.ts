export interface MarkerStyle {
  fill: string
  outline: string
  outlineWidth: number
  ring: boolean
  ringColor?: string
}

export function markerStyleForBody(bodyId: string | undefined, color: string): MarkerStyle {
  const baseStyle = {
    fill: color,
    outline: color,
    outlineWidth: 2,
    ring: false,
  }

  switch (bodyId) {
    case 'venus':
      return { ...baseStyle, fill: '#f4c85a', outline: '#8f6f22' }
    case 'mars':
      return { ...baseStyle, fill: '#d75a32', outline: '#78311c' }
    case 'jupiter':
      return { ...baseStyle, fill: '#d98b45', outline: '#74401d' }
    case 'saturn':
      return {
        ...baseStyle,
        fill: '#d6b36a',
        outline: '#766033',
        ring: true,
        ringColor: 'rgba(232,211,160,0.95)',
      }
    default:
      return baseStyle
  }
}
