// Display helpers for the "Sermons of the Prophet Joseph Smith" volume.
//
// This volume is a collection of separate discourses, so a "chapter" here isn't
// a continuation of the one before it the way Genesis 4 follows Genesis 3 — each
// one is its own sermon, and the only fact that orients the reader is the date
// it was given. That date is stored (glued to a source citation) in the
// chapter's `title` field, e.g. "June 27, 1839 — DHC 3:379-381".
//
// These helpers surface the date as the label the reader sees, while the numeric
// reference ("Nauvoo Era 47") stays the stable id that marks, links, themes, and
// scopes are keyed on everywhere else. Nothing here changes any other volume.

export const SERMONS_VOLUME = "Sermons of the Prophet Joseph Smith";

// True only for the Joseph Smith sermons volume, so callers can gate the
// date-based labeling to it and leave every other volume untouched.
export const isSermonsVolume = (volumeName: string): boolean =>
  volumeName === SERMONS_VOLUME;

// A sermon's recorded date, taken from the part of its `title` before the
// em dash ("June 27, 1839 — DHC 3:379-381" -> "June 27, 1839"). Hyphens only
// ever appear inside the citation half (page ranges like "3:379-381"), so the
// em dash is an unambiguous split. Returns "" when the sermon has no recorded
// date (its title is a bare citation with no em dash, e.g. "DHC 4:269").
export const sermonDate = (title?: string): string => {
  if (!title) return "";
  const i = title.indexOf("\u2014");
  return i < 0 ? "" : title.slice(0, i).trim();
};

// The label to show for a sermon "chapter": its date when it has one, otherwise
// a "Sermon N" fallback (16 of 157 sermons carry no date). `n` is the chapter's
// sequence number.
export const sermonLabel = (title: string | undefined, n: number): string =>
  sermonDate(title) || "Sermon " + n;
