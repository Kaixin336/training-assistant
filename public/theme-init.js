// Runs before first paint so an explicit light/dark choice never flashes the other theme.
try {
  var choice = localStorage.getItem("kai-theme");
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
} catch (error) { /* Private mode: follow the system theme. */ }
