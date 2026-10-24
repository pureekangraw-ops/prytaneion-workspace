const surface = document.querySelector('[data-prism-surface]');
if (surface) {
  const input = surface.querySelector('[data-prism-input]');
  const status = surface.querySelector('[data-prism-status]');
  let timer;
  const notify = (message) => { status.textContent = message; clearTimeout(timer); timer = setTimeout(() => { status.textContent = ''; }, 2600); };
  surface.querySelector('[data-prism-form]')?.addEventListener('submit', (event) => { event.preventDefault(); const value = input.value.trim(); if (!value) return notify('พิมพ์คำสั่งก่อนครับ'); notify('รับคำสั่งแล้ว · GO Hub จัด Work / Route ให้'); input.value = ''; });
  surface.querySelectorAll('[data-prism-command]').forEach((button) => button.addEventListener('click', () => { input.value = button.dataset.prismCommand; input.focus(); }));
  surface.querySelector('[data-prism-go]')?.addEventListener('click', () => notify('ส่งเข้า GO Work แล้ว · ใช้ Work/Checkpoint เดิม'));
  surface.querySelector('[data-prism-light]')?.addEventListener('click', () => notify('สร้าง trigger กลับ LIGHT แล้ว · ไม่เปลี่ยน authority'));
  surface.querySelector('[data-prism-run]')?.addEventListener('click', () => notify('เริ่มงานวิ่ง · จุด 1 รับเอกสาร · local-first map'));
  const work = document.querySelector('[data-centre-work]');
  const workId = surface.querySelector('[data-prism-work]');
  const syncWork = () => { if (workId) workId.textContent = work?.textContent?.trim() || 'CURRENT WORK'; };
  syncWork();
  window.setInterval(syncWork, 1000);
}
