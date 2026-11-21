
(async () => {
  try {
    const url = new URL(location.href);
    url.pathname += '.bin';
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error('Unavailable');
    const markup = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();
    document.open();
    document.write(markup);
    document.close();
  } catch (error) {
    document.body.textContent = 'This archived card could not load. Try opening it from the dashboard in a recent browser.';
  }
})();
