(function () {
  const btn  = document.getElementById('nav-hamburger')
  const menu = document.getElementById('admin-nav-links')
  if (!btn || !menu) return

  function open() {
    menu.classList.add('open')
    btn.classList.add('open')
    btn.setAttribute('aria-expanded', 'true')
    document.body.style.overflow = 'hidden'
  }

  function close() {
    menu.classList.remove('open')
    btn.classList.remove('open')
    btn.setAttribute('aria-expanded', 'false')
    document.body.style.overflow = ''
  }

  btn.addEventListener('click', () => menu.classList.contains('open') ? close() : open())

  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', close))

  document.addEventListener('click', (e) => {
    if (menu.classList.contains('open') && !e.target.closest('.admin-nav')) close()
  })

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close() })
})()
