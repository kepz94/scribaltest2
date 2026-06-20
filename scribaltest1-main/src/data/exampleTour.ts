import type { TourStep } from "../components/SpotlightTour";

// The spotlight that runs the first time the example reaches the compiled
// screen: what just happened, and how to read and navigate the study. The
// targets ("ex-formats", "ex-tryit") are present in both the mobile
// (MobileCompile) and desktop (DesktopExample) compiled views.
export const EXAMPLE_TOUR: TourStep[] = [
  {
    title: "Your marks, compiled",
    body:
      "Scribal gathered every mark from John 1 and grouped it by color \u2014 each color a theme. This study is what those marks make; you didn't write a word of it by hand.",
  },
  {
    target: '[data-tour="ex-formats"]',
    title: "One study, several forms",
    body:
      "The same marks read as an Outline, a flowing Distilled summary, or Relational pairs. Switch between them here. Within Outline you can also reorder by emphasis and show the full verses.",
    placement: "bottom",
  },
  {
    title: "Nothing is hidden",
    body:
      "Every line traces back to a verse you marked \u2014 select one to jump to it in the chapter. The app only arranges what you marked; it never adds meaning of its own.",
  },
  {
    target: '[data-tour="ex-tryit"]',
    title: "Now make your own",
    body:
      "Mark a chapter yourself and Scribal compiles it exactly like this.",
    placement: "top",
  },
];
