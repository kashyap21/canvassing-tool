import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeQuery, splitMatch, suggestStreets } from "../lib/streetSuggestions";

// Google-style suggestion list for the Street name field.
//
// This replaces the native <datalist>, which never showed up reliably: iOS
// Safari does not render one at all, Firefox/Safari only match on the start of
// the value, and Chrome hides it whenever autocomplete="off" is set. Everything
// below is our own markup, so the same list appears on every browser.
//
// Suggestions are data only — the distinct street names already recorded in the
// database (loaded once by App.jsx). Nothing is invented or geocoded, and the
// typist can always ignore the list and type a brand-new street.

export default function StreetAutocomplete({
  id,
  value,
  onChange,
  streets,
  placeholder,
  listId,
  // For an input pinned near the bottom of the screen, where a list opening
  // downwards would fall out of view.
  dropUp = false,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1); // -1 = nothing highlighted yet
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const optionId = (i) => `${listId}-opt-${i}`;

  const query = normalizeQuery(value);
  const suggestions = useMemo(() => suggestStreets(streets, query), [streets, query]);

  // A fresh keystroke drops the highlight: Enter then submits what was typed
  // rather than a row the typist never looked at.
  useEffect(() => setActive(-1), [query]);

  // Close when the tap lands anywhere else (the list is not focusable, so blur
  // alone would fire before a click on a row registers).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const showList = open && suggestions.length > 0;

  function choose(street) {
    onChange(street);
    // Focus first: a focus() that lands after setOpen(false) would re-open the
    // list through onFocus, since that update queues last.
    document.getElementById(id)?.focus();
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!suggestions.length) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === "ArrowDown" ? 0 : suggestions.length - 1);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === "Enter" && showList && active >= 0) {
      e.preventDefault(); // pick the street instead of submitting the form
      choose(suggestions[active]);
      return;
    }
    if (e.key === "Escape" && showList) {
      e.stopPropagation(); // in the edit modal, keep this Escape off the dialog
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === "Tab") setOpen(false);
  }

  return (
    <div className="combo" ref={boxRef}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {showList && (
        <ul
          className={dropUp ? "combo-list is-up" : "combo-list"}
          id={listId}
          role="listbox"
          ref={listRef}
        >
          {suggestions.map((street, i) => {
            const [before, match, after] = splitMatch(street, query);
            return (
              <li
                key={street}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={i === active ? "combo-option is-active" : "combo-option"}
                onMouseDown={(e) => e.preventDefault()} // don't blur the input
                onClick={() => choose(street)}
                onMouseEnter={() => setActive(i)}
              >
                <svg className="combo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
                    fill="currentColor"
                  />
                </svg>
                <span className="combo-text">
                  {before}
                  <strong>{match}</strong>
                  {after}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
