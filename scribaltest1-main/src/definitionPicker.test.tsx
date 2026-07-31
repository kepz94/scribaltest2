// Mounts the real DefinitionView against a real dictionary entry. "The picker
// isn't working" needs a reproduction, not a reading of the source.
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import DefinitionView from "./components/DefinitionView";
import {
  linkableDefinitionsFor,
  hasChosenSenses,
} from "./linkableDefinitions";
import { WordTag } from "./types";

// Two senses, in the shape the 1828 file actually uses: blank-line-separated
// paragraphs, the entry opening with a header line.
const ENTRY = [
  "GRACE, noun [Latin gratia.]",
  "1. Favor; good will; kindness.",
  "2. The free unmerited love and favor of God.",
].join("\n\n");

const COLORS = {
  text: "var(--text)",
  muted: "var(--muted)",
  border: "var(--border)",
  soft: "var(--soft)",
};

function mount(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(ui);
  });
  return host;
}

describe("DefinitionView sense picker", () => {
  it("renders one control per numbered sense when a picker is wired", () => {
    const host = mount(
      <DefinitionView
        word="grace"
        result={{ key: "grace", definition: ENTRY }}
        colors={COLORS}
        senses={[]}
        onPickSenses={() => {}}
        onToggleTag={() => {}}
      />
    );
    expect(host.querySelectorAll("[data-sense]")).toHaveLength(2);
  });

  it("stays a plain read-only lookup when no picker is wired", () => {
    const host = mount(
      <DefinitionView
        word="grace"
        result={{ key: "grace", definition: ENTRY }}
        colors={COLORS}
      />
    );
    expect(host.querySelectorAll("[data-sense]")).toHaveLength(0);
  });

  it("reports the sense number the dictionary prints when one is clicked", () => {
    const picked: number[][] = [];
    const host = mount(
      <DefinitionView
        word="grace"
        result={{ key: "grace", definition: ENTRY }}
        colors={COLORS}
        senses={[]}
        onPickSenses={(s) => picked.push(s)}
        onToggleTag={() => {}}
      />
    );
    const second = host.querySelector('[data-sense="2"]') as HTMLElement;
    expect(second).toBeTruthy();
    act(() => {
      second.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(picked).toEqual([[2]]);
  });

  it("shows which senses are already chosen when reopened", () => {
    const host = mount(
      <DefinitionView
        word="grace"
        result={{ key: "grace", definition: ENTRY }}
        colors={COLORS}
        senses={[2]}
        onPickSenses={() => {}}
        onToggleTag={() => {}}
      />
    );
    const first = host.querySelector('[data-sense="1"]') as HTMLElement;
    const second = host.querySelector('[data-sense="2"]') as HTMLElement;
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(second.getAttribute("aria-pressed")).toBe("true");
  });

  it("removes a sense that is clicked again", () => {
    const picked: number[][] = [];
    const host = mount(
      <DefinitionView
        word="grace"
        result={{ key: "grace", definition: ENTRY }}
        colors={COLORS}
        senses={[1, 2]}
        onPickSenses={(s) => picked.push(s)}
        onToggleTag={() => {}}
      />
    );
    act(() => {
      (host.querySelector('[data-sense="1"]') as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    expect(picked).toEqual([[2]]);
  });

  it("hides the picker for a single-sense entry — nothing to choose between", () => {
    const host = mount(
      <DefinitionView
        word="zeal"
        result={{ key: "zeal", definition: "ZEAL, noun Passionate ardor." }}
        colors={COLORS}
        senses={[]}
        onPickSenses={() => {}}
        onToggleTag={() => {}}
      />
    );
    expect(host.querySelectorAll("[data-sense]")).toHaveLength(0);
  });
});

// The gate behind the toolbar's Link definition button. It went missing because
// this returned [] — every row resolves through the dictionary, and neither
// outline had loaded it.
describe("linkableDefinitionsFor", () => {
  const tag = (over: Partial<WordTag> = {}): WordTag => ({
    id: "Alma 32:21:8:13",
    reference: "Alma 32:21",
    start: 8,
    end: 13,
    word: "faith",
    dictKey: "faith",
    ...over,
  });

  it("offers nothing until the dictionary is in memory", () => {
    expect(linkableDefinitionsFor([tag({ senses: [1] })], false)).toEqual([]);
  });

  it("offers nothing for a tag with no chosen senses", () => {
    expect(hasChosenSenses([tag()])).toBe(false);
    expect(linkableDefinitionsFor([tag()], true)).toEqual([]);
  });

  it("knows when a study has something worth fetching the dictionary for", () => {
    expect(hasChosenSenses([tag({ senses: [2] })])).toBe(true);
    expect(hasChosenSenses([])).toBe(false);
    expect(hasChosenSenses(undefined)).toBe(false);
  });
});
