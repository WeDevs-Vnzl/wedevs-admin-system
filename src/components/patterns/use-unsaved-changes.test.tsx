import { fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChanges } from "./use-unsaved-changes";

const MESSAGE = "You have unsaved changes.";

function DirtyForm() {
  const {
    register,
    formState: { isDirty },
  } = useForm({ defaultValues: { name: "" } });
  useUnsavedChanges(isDirty, MESSAGE);

  return (
    <>
      <input aria-label="Name" {...register("name")} />
      {/* A native anchor on purpose: the hook intercepts plain link clicks. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/clients">Back to list</a>
    </>
  );
}

function dispatchBeforeUnload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe("useUnsavedChanges", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not guard a pristine form", () => {
    render(<DirtyForm />);
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });

  it("guards the tab close once the form is dirty", () => {
    render(<DirtyForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kairos" } });
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  });

  it("asks before an in-app link leaves a dirty form and cancels when refused", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DirtyForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kairos" } });

    const notPrevented = fireEvent.click(screen.getByText("Back to list"));

    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(notPrevented).toBe(false);
  });
});
