/*
 * Copyright (C) 2024-2025 Rem01Gaming
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import enTranslations from "../locales/strings/en.json";
import languages from "../locales/languages.json";

// Cache for translations
const cachedEnglishTranslations = enTranslations;
let currentTranslations = null;

// Dynamic imports for non-English translations
const translationModules = import.meta.glob(
  "../locales/strings/!(en).json", // Exclude en.json from dynamic imports
  { eager: false },
);

// Synchronous translation lookup
// This function also will parse args from it's input
function getTranslationSync(key, ...args) {
  const keys = key.split(".");
  let value = currentTranslations || cachedEnglishTranslations;

  // Try current language
  for (const k of keys) {
    value = value?.[k];
    if (!value) break;
  }

  // Fallback to English
  if (!value) {
    value = cachedEnglishTranslations;
    for (const k of keys) {
      value = value?.[k];
      if (!value) break;
    }
  }

  // Return key if no translation found
  if (!value) return key;

  // Handle placeholder replacement
  if (args.length > 0 && typeof value === "string") {
    return value.replace(/\{(\d+)\}/g, (match, index) => {
      const idx = parseInt(index);
      return args[idx] !== undefined ? args[idx] : match;
    });
  }

  return value;
}

// Expose to global scope
window.getTranslation = getTranslationSync;

async function loadTranslations(lang) {
  // Use static import for English
  if (lang === "en") return cachedEnglishTranslations;

  const filePath = `../locales/strings/${lang}.json`;

  if (translationModules[filePath]) {
    try {
      const module = await translationModules[filePath]();
      return module.default;
    } catch (error) {
      console.error(`Failed to load ${lang} translations:`, error);
      return cachedEnglishTranslations;
    }
  } else {
    console.warn(`No translation file for ${lang}, falling back to English`);
    return cachedEnglishTranslations;
  }
}

function applyTranslations(translations) {
  // Text content translation
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const keys = el.getAttribute("data-i18n").split(".");
    let value = translations;

    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) break;
    }

    if (value === undefined) {
      value = cachedEnglishTranslations;
      for (const key of keys) value = value?.[key];
    }

    if (value !== undefined) {
      el.textContent = value;
    }
  });

  // Placeholder translation for inputs/textareas/selects
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;

    // Support nested keys like 'some.section.key'
    const keys = key.split(".");
    let value = translations;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }

    // Fallback to English if not found
    if (value === undefined) {
      value = cachedEnglishTranslations;
      for (const k of keys) {
        value = value?.[k];
        if (value === undefined) break;
      }
    }

    if (value !== undefined && typeof value === "string") {
      // If element is an input-like, set placeholder or value accordingly
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        // For inputs of type button/submit use value, otherwise placeholder
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (type === "button" || type === "submit") {
          el.value = value;
        } else {
          el.setAttribute("placeholder", value);
        }
      } else {
        // Generic fallback: set attribute placeholder
        el.setAttribute("placeholder", value);
      }
    }
  });

  // Also support elements that want their `value` attribute to be translated
  document.querySelectorAll("[data-i18n-value]").forEach((el) => {
    const key = el.getAttribute("data-i18n-value");
    if (!key) return;
    const keys = key.split(".");
    let value = translations;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }
    if (value === undefined) {
      value = cachedEnglishTranslations;
      for (const k of keys) {
        value = value?.[k];
        if (value === undefined) break;
      }
    }
    if (value !== undefined && typeof value === "string") {
      el.value = value;
      // For buttons, also set textContent for consistency
      if (el.tagName === "BUTTON") el.textContent = value;
    }
  });
  // Modified: refresh per-user status labels when the language changes.
  window.dispatchEvent(new Event("languagechange"));
}

async function initI18n() {
  const languageBtn = document.getElementById("language_btn");
  const languageModal = document.getElementById("language_modal");
  const languageSelection = document.getElementById("language_selection");

  if (!languageBtn || !languageModal || !languageSelection) return;

  try {
    // Merge languages with English as default
    const allLanguages = { en: "English", ...languages };

    // Populate language selection modal
    languageSelection.innerHTML = "";
    for (const [code, name] of Object.entries(allLanguages)) {
      const button = document.createElement("button");
      button.textContent = name;
      button.dataset.lang = code;
      button.className =
        "btn btn-block bg-primary hover:bg-primary text-on-primary py-1 w-full rounded-md text-left";
      button.setAttribute("role", "button");
      button.setAttribute("aria-pressed", "false");
      languageSelection.appendChild(button);
    }

    // Determine initial language
    const savedLang = localStorage.getItem("selectedLanguage");
    const browserLangs = [
      ...(navigator.languages || []),
      navigator.language,
      navigator.userLanguage,
    ].filter(Boolean);

    let lang = savedLang || "en";
    if (!savedLang) {
      for (const browserLang of browserLangs) {
        const normalizedLang = browserLang.toLowerCase().replace(/_/g, "-");
        if (allLanguages[normalizedLang]) {
          lang = normalizedLang;
          break;
        }
        const baseLang = normalizedLang.split("-")[0];
        if (allLanguages[baseLang]) {
          lang = baseLang;
          break;
        }
      }
    }

    currentTranslations = await loadTranslations(lang);
    applyTranslations(currentTranslations);

    // Handle settings button click
    languageBtn.addEventListener("click", () => {
      document.documentElement.classList.add("modal-open");
      languageModal.showModal();
    });

    // Handle language selection
    languageSelection.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const newLang = btn.dataset.lang;
      if (!newLang) return;

      languageSelection.querySelectorAll("button").forEach((b) => {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });

      const oldTranslations = currentTranslations;
      try {
        currentTranslations = await loadTranslations(newLang);
        applyTranslations(currentTranslations);
        localStorage.setItem("selectedLanguage", newLang);
        languageModal.close();
        document.documentElement.classList.remove("modal-open");
      } catch (error) {
        currentTranslations = oldTranslations;
        console.error("Language switch failed:", error);
      }
    });
  } catch (error) {
    console.error("i18n initialization failed:", error);
  }
}

// Initialize immediately if DOM is ready, otherwise wait
if (document.readyState !== "loading") {
  initI18n();
} else {
  document.addEventListener("DOMContentLoaded", initI18n);
}
