const root = document.documentElement;
const themeToggle = document.querySelector("#theme-toggle");
const copyButton = document.querySelector("#copy-command");

function updateThemeControl() {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  themeToggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
}

themeToggle.addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("sdd-theme", root.dataset.theme);
  updateThemeControl();
});

copyButton.addEventListener("click", async () => {
  const label = copyButton.querySelector("span");

  try {
    await navigator.clipboard.writeText(copyButton.dataset.copy);
    label.textContent = "Copied";
    window.setTimeout(() => {
      label.textContent = "Copy";
    }, 1800);
  } catch {
    label.textContent = "Select text";
  }
});

updateThemeControl();
