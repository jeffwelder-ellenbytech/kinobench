declare module 'plotly.js-dist-min' {
  import type { Config, Data, Layout, PlotlyHTMLElement } from 'plotly.js'

  interface PlotlyStatic {
    newPlot(
      root: HTMLElement,
      data: Data[],
      layout?: Partial<Layout>,
      config?: Partial<Config>,
    ): Promise<PlotlyHTMLElement>
    react(
      root: HTMLElement,
      data: Data[],
      layout?: Partial<Layout>,
      config?: Partial<Config>,
    ): Promise<PlotlyHTMLElement>
    purge(root: HTMLElement): void
    Plots: {
      resize(root: HTMLElement): Promise<void>
    }
  }

  const Plotly: PlotlyStatic
  export default Plotly
}
