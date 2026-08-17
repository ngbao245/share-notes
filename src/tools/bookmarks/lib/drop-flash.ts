// ============================================================
// drop-flash — subtle post-drop animation cho bookmark hoặc category vừa
// được reorder. Ring pulse expand + scale nhẹ, 400ms.
//
// Dùng thay `@atlaskit/pragmatic-drag-and-drop-flourish` mặc định (Atlassian
// dùng background flash trông xấu). Ở đây dùng CSS keyframe `drop-flash`
// định nghĩa trong tailwind.config.ts.
//
// Cách hoạt động:
//   1. Remove class (nếu còn từ lần drop trước)
//   2. Force reflow bằng cách đọc offsetWidth → browser flush layout
//   3. Add class → animation re-fires
//   4. Sau animationend → remove class để không leak state
// ============================================================

const FLASH_CLASS = 'animate-drop-flash';

export function flashElement(el: HTMLElement) {
  el.classList.remove(FLASH_CLASS);
  // Reflow để restart animation nếu đang chạy
  void el.offsetWidth;
  el.classList.add(FLASH_CLASS);

  const cleanup = () => {
    el.classList.remove(FLASH_CLASS);
    el.removeEventListener('animationend', cleanup);
  };
  el.addEventListener('animationend', cleanup);
}
