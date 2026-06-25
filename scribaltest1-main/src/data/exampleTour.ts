import type { TourStep } from "../components/SpotlightTour";

// Spotlight that runs on the example's marked reading screen (mobile): what this
// screen is and how marking leads into compiling. "ex-compile" is the Compile
// button on the example's reading screen.
export const READING_TOUR: TourStep[] = [
  {
    title: "A marked chapter",
    body:
      "This is John 1 with marks already on it. In Scribal you read first, then mark the words that stand out \u2014 the colored text is what a reader marked, in their own colors.",
  },
  {
    target: '[data-tour="ex-compile"]',
    title: "Then compile",
    body:
      "Once a chapter is marked, Compile gathers the marks into a study. Here's what these become.",
    placement: "top",
  },
];

// Spotlight that runs the first time the example reaches the compiled screen:
// what just happened, and how to read and navigate the study. The targets
// ("ex-formats", "ex-tryit") exist in both the mobile (MobileCompile) and
// desktop (DesktopExample) compiled views.
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
