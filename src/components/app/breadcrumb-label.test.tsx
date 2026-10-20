import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { BreadcrumbLabel, BreadcrumbLabelProvider, useBreadcrumbLabels } from "./breadcrumb-label";

// Shows the registered labels as JSON so each test can assert the registry state.
function Probe() {
  return <output data-testid="labels">{JSON.stringify(useBreadcrumbLabels())}</output>;
}

function labelsOf(): Record<string, string> {
  return JSON.parse(screen.getByTestId("labels").textContent ?? "{}");
}

describe("BreadcrumbLabel", () => {
  it("registers its label for the segment", () => {
    render(
      <BreadcrumbLabelProvider>
        <Probe />
        <BreadcrumbLabel segment="cli_1" label="CLI-0007 · Kairos Studio" />
      </BreadcrumbLabelProvider>,
    );
    expect(labelsOf()).toEqual({ cli_1: "CLI-0007 · Kairos Studio" });
  });

  it("updates the registered label when its label prop changes", () => {
    function Page() {
      const [name, setName] = useState("Kairos Studio");
      return (
        <>
          <button onClick={() => setName("Kairos Labs")}>rename</button>
          <BreadcrumbLabel segment="cli_1" label={`CLI-0007 · ${name}`} />
        </>
      );
    }
    render(
      <BreadcrumbLabelProvider>
        <Probe />
        <Page />
      </BreadcrumbLabelProvider>,
    );
    act(() => screen.getByRole("button", { name: "rename" }).click());
    expect(labelsOf()).toEqual({ cli_1: "CLI-0007 · Kairos Labs" });
  });

  it("unregisters on unmount", () => {
    function Page({ open }: { open: boolean }) {
      return (
        <>
          <Probe />
          {open ? <BreadcrumbLabel segment="cli_1" label="CLI-0007" /> : null}
        </>
      );
    }
    const { rerender } = render(
      <BreadcrumbLabelProvider>
        <Page open />
      </BreadcrumbLabelProvider>,
    );
    expect(labelsOf()).toEqual({ cli_1: "CLI-0007" });

    rerender(
      <BreadcrumbLabelProvider>
        <Page open={false} />
      </BreadcrumbLabelProvider>,
    );
    expect(labelsOf()).toEqual({});
  });

  it("keeps the labels of other segments when one unmounts", () => {
    function Page({ second }: { second: boolean }) {
      return (
        <>
          <Probe />
          <BreadcrumbLabel segment="cli_1" label="A" />
          {second ? <BreadcrumbLabel segment="prj_1" label="B" /> : null}
        </>
      );
    }
    const { rerender } = render(
      <BreadcrumbLabelProvider>
        <Page second />
      </BreadcrumbLabelProvider>,
    );
    rerender(
      <BreadcrumbLabelProvider>
        <Page second={false} />
      </BreadcrumbLabelProvider>,
    );
    expect(labelsOf()).toEqual({ cli_1: "A" });
  });

  it("renders nothing and does not throw without a provider", () => {
    const { container } = render(<BreadcrumbLabel segment="cli_1" label="X" />);
    expect(container).toBeEmptyDOMElement();
  });
});
