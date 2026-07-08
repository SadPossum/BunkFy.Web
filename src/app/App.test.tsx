import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the operations workspace", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Arrivals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New booking" })).toBeInTheDocument();
  });
});

