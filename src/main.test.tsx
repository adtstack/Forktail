import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RootApplication } from "./RootApplication";

const main = <div data-testid="main-app">main</div>;
const detached = <div data-testid="detached-app">detached</div>;

describe("root surface routing", () => {
  it("mounts only the detached root for the fixed child marker", () => {
    const markup = renderToStaticMarkup(
      <RootApplication search="?surface=folder-review" main={main} detached={detached} />,
    );

    expect(markup).toContain('data-testid="detached-app"');
    expect(markup).not.toContain('data-testid="main-app"');
  });

  it("does not accept path-bearing or unknown child routes", () => {
    const pathBearing = renderToStaticMarkup(
      <RootApplication
        search="?surface=folder-review&path=/private/file"
        main={main}
        detached={detached}
      />,
    );
    const ordinary = renderToStaticMarkup(
      <RootApplication search="" main={main} detached={detached} />,
    );

    expect(pathBearing).toContain('data-testid="main-app"');
    expect(ordinary).toContain('data-testid="main-app"');
    expect(pathBearing).not.toContain('data-testid="detached-app"');
  });
});
