// Плавающая подложка под активным пунктом в переключателях и в нижнем меню.
// Позицию считаем по реальной кнопке, поэтому подложка всегда стоит ровно,
// в том числе после загрузки шрифта и поворота экрана.
const SEL = '.segment, .tabbar-inner'

function sync() {
  document.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
    const on = el.querySelector<HTMLElement>(':scope > .on')
    if (!on) {
      el.classList.remove('has-pill')
      return
    }
    el.style.setProperty('--pl', on.offsetLeft + 'px')
    el.style.setProperty('--pt', on.offsetTop + 'px')
    el.style.setProperty('--pw', on.offsetWidth + 'px')
    el.style.setProperty('--ph', on.offsetHeight + 'px')
    if (!el.classList.contains('has-pill')) {
      el.classList.add('has-pill')
      // Первое появление без анимации, дальше подложка скользит
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('pill-ready')))
    }
  })
}

export function startPills() {
  let raf = 0
  let late = 0
  const schedule = () => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(sync)
    // Повторная сверка, когда закончатся анимации появления экрана
    clearTimeout(late)
    late = window.setTimeout(sync, 450)
  }
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  addEventListener('resize', schedule)
  document.fonts?.ready.then(schedule)
  schedule()
}
