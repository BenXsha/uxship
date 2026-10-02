type EChartsType = typeof import('echarts')

let echartsModule: EChartsType | null = null

async function getECharts(): Promise<EChartsType> {
  if (!echartsModule) {
    echartsModule = await import('echarts')
  }
  return echartsModule
}

export async function renderChartToSVG(
  option: any,
  width: number,
  height: number
): Promise<{ svgContent: string; width: number; height: number }> {
  const echarts = await getECharts()
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width,
    height,
  })
  chart.setOption(option)
  const svgContent = chart.renderToSVGString()
  chart.dispose()
  return { svgContent, width, height }
}
