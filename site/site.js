const copyButton = document.querySelector("#copy-command");
const commandText = document.querySelector(".commandBlock pre");
const primaryNavigationLinks = [...document.querySelectorAll(".siteNav a[href^='#']")];
const mobileNavigationLinks = [...document.querySelectorAll(".mobileNav a[href^='#']")];
const trackedSections = [...document.querySelectorAll("main > section[id]")];

copyButton?.addEventListener("click", async () => {
  const label = copyButton.querySelector("span");

  try {
    await navigator.clipboard.writeText(copyButton.dataset.copy);
    label.textContent = "Copied";
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(commandText);
    selection.removeAllRanges();
    selection.addRange(range);
    label.textContent = "Selected";
  }

  window.setTimeout(() => {
    label.textContent = "Copy";
  }, 1800);
});

const navigationTarget = {
  top: "top",
  problem: "problem",
  model: "model",
  process: "process",
  traceability: "traceability",
  example: "example",
  implementation: "implementation",
  toolchain: "implementation",
};

let navigationFrame;

const updateCurrentNavigation = () => {
  const marker = window.scrollY + document.querySelector(".siteHeader").offsetHeight + 120;
  const currentSection = trackedSections.reduce((current, section) => (
    section.offsetTop <= marker ? section : current
  ), null);
  const target = currentSection ? navigationTarget[currentSection.id] : null;
  const inImplementation = target === "implementation";

  primaryNavigationLinks.forEach((link) => {
    const isCurrent = link.hash === `#${target}`;
    link.toggleAttribute("aria-current", isCurrent);
    if (isCurrent) {
      link.setAttribute("aria-current", "location");
    }
  });

  mobileNavigationLinks.forEach((link) => {
    const isCurrent = target && (
      link.dataset.navGroup === "implementation" ? inImplementation : !inImplementation
    );
    link.toggleAttribute("aria-current", Boolean(isCurrent));
    if (isCurrent) {
      link.setAttribute("aria-current", "location");
    }
  });
};

const requestNavigationUpdate = () => {
  if (navigationFrame) {
    return;
  }

  navigationFrame = window.requestAnimationFrame(() => {
    navigationFrame = null;
    updateCurrentNavigation();
  });
};

window.addEventListener("scroll", requestNavigationUpdate, { passive: true });
window.addEventListener("resize", requestNavigationUpdate);
window.addEventListener("hashchange", requestNavigationUpdate);
updateCurrentNavigation();
