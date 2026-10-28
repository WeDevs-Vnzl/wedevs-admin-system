import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import esCommon from "@/i18n/messages/es/common.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esGraph from "@/i18n/messages/es/graph.json";
import esPatterns from "@/i18n/messages/es/patterns.json";

/** Renders `ui` with the Spanish messages the graph screens read. Test only. */
export function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="es"
      timeZone="America/Caracas"
      messages={{ common: esCommon, enums: esEnums, graph: esGraph, patterns: esPatterns }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

/**
 * jsdom stand-ins React Flow needs to measure and show nodes (reactflow.dev "Testing"): a ResizeObserver that reports
 * on observe, `DOMMatrixReadOnly` for the viewport scale, element sizes from the inline style, and `getBBox`.
 */
export function installReactFlowMocks() {
  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const size = { inlineSize: 100, blockSize: 40 };
      const entry = {
        target,
        contentRect: {
          width: 100,
          height: 40,
          top: 0,
          left: 0,
          x: 0,
          y: 0,
          right: 100,
          bottom: 40,
        },
        borderBoxSize: [size],
        contentBoxSize: [size],
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixReadOnlyMock {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return parseFloat(this.style.height) || 1;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return parseFloat(this.style.width) || 1;
      },
    },
  });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
}
