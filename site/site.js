const copyButton = document.querySelector("#copy-command");

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
