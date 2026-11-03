import { $, getJSON, topbar, pollGpu } from './common.js';
import { card } from './cards.js';
topbar('runs');
pollGpu(() => {});
async function load() {
  const d = await getJSON('/api/runs');
  const el = $('#cards'); el.innerHTML = '';
  d.runs.forEach(r => el.append(card(r)));
  $('#runs-sub').textContent = `${d.runs.length} games built from a one-paragraph pitch, newest first. Click one to watch how it was made.`;
}
load(); setInterval(load, 15000);
