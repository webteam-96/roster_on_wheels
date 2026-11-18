// GooeyNav — React Bits, upstream source with ONE marked change: the particle
// engine and the effect positioner are EXPORTED, so the site's own <nav> can
// drive them.
//
// WHY THE SITE DOES NOT RENDER <GooeyNav> ITSELF.
// GooeyNav owns its own activeIndex, renders one flat <a> per item and takes
// over the click. The handloom primary nav is not that shape and cannot become
// it without losing real behaviour:
//   • submenus — PROJECTS has one, with a <button> trigger, aria-expanded,
//     aria-controls, hover intent and Arrow/Home/End key handling;
//   • aria-current="page", which is what the theme's active underline keys off;
//   • external links, which need target/rel from menuExternal();
//   • SPA routing — the drawer and the nav share menu data and the router owns
//     the transition.
// So the COMPONENT stays here, usable as-is anywhere a plain nav is wanted, and
// SiteHandloom borrows its effect: the pill and the particle burst are painted
// over the real <ul>, which keeps every one of the behaviours above.

import { useRef, useEffect, useState } from 'react';
import './GooeyNav.css';

const noise = (n = 1) => n / 2 - Math.random() * n;

const getXY = (distance, pointIndex, totalPoints) => {
  const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
  return [distance * Math.cos(angle), distance * Math.sin(angle)];
};

const createParticle = (i, t, d, r, particleCount, colors) => {
  let rotate = noise(r / 10);
  return {
    start: getXY(d[0], particleCount - i, particleCount),
    end: getXY(d[1] + noise(7), particleCount - i, particleCount),
    time: t,
    scale: 1 + noise(0.2),
    color: colors[Math.floor(Math.random() * colors.length)],
    rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10
  };
};

// EXPORTED (the marked change). Same body as upstream's inner makeParticles,
// with the four values it used to close over passed in instead.
export function makeParticles(element, opts = {}) {
  const {
    animationTime = 600, particleCount = 15, particleDistances = [90, 10],
    particleR = 100, timeVariance = 300, colors = [1, 2, 3, 1, 2, 3, 1, 4]
  } = opts;
  const d = particleDistances;
  const r = particleR;
  const bubbleTime = animationTime * 2 + timeVariance;
  element.style.setProperty('--time', `${bubbleTime}ms`);

  for (let i = 0; i < particleCount; i++) {
    const t = animationTime * 2 + noise(timeVariance * 2);
    const p = createParticle(i, t, d, r, particleCount, colors);
    element.classList.remove('active');

    setTimeout(() => {
      const particle = document.createElement('span');
      const point = document.createElement('span');
      particle.classList.add('particle');
      particle.style.setProperty('--start-x', `${p.start[0]}px`);
      particle.style.setProperty('--start-y', `${p.start[1]}px`);
      particle.style.setProperty('--end-x', `${p.end[0]}px`);
      particle.style.setProperty('--end-y', `${p.end[1]}px`);
      particle.style.setProperty('--time', `${p.time}ms`);
      particle.style.setProperty('--scale', `${p.scale}`);
      particle.style.setProperty('--color', `var(--color-${p.color}, white)`);
      particle.style.setProperty('--rotate', `${p.rotate}deg`);

      point.classList.add('point');
      particle.appendChild(point);
      element.appendChild(particle);
      requestAnimationFrame(() => {
        element.classList.add('active');
      });
      setTimeout(() => {
        try {
          element.removeChild(particle);
        } catch {
          // Do nothing
        }
      }, t);
    }, 30);
  }
}

// EXPORTED. Upstream kept this closed over three refs; it takes them now.
export function updateEffectPosition(element, container, filterEl, textEl) {
  if (!container || !filterEl || !textEl || !element) return;
  const containerRect = container.getBoundingClientRect();
  const pos = element.getBoundingClientRect();

  const styles = {
    left: `${pos.x - containerRect.x}px`,
    top: `${pos.y - containerRect.y}px`,
    width: `${pos.width}px`,
    height: `${pos.height}px`
  };
  Object.assign(filterEl.style, styles);
  Object.assign(textEl.style, styles);
  textEl.innerText = element.innerText;
}

const GooeyNav = ({
  items,
  animationTime = 600,
  particleCount = 15,
  particleDistances = [90, 10],
  particleR = 100,
  timeVariance = 300,
  colors = [1, 2, 3, 1, 2, 3, 1, 4],
  initialActiveIndex = 0
}) => {
  const containerRef = useRef(null);
  const navRef = useRef(null);
  const filterRef = useRef(null);
  const textRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const opts = { animationTime, particleCount, particleDistances, particleR, timeVariance, colors };

  const handleClick = (e, index) => {
    const liEl = e.currentTarget;
    if (activeIndex === index) return;

    setActiveIndex(index);
    updateEffectPosition(liEl, containerRef.current, filterRef.current, textRef.current);

    if (filterRef.current) {
      const particles = filterRef.current.querySelectorAll('.particle');
      particles.forEach(p => filterRef.current.removeChild(p));
    }

    if (textRef.current) {
      textRef.current.classList.remove('active');

      void textRef.current.offsetWidth;
      textRef.current.classList.add('active');
    }

    if (filterRef.current) {
      makeParticles(filterRef.current, opts);
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const liEl = e.currentTarget.parentElement;
      if (liEl) {
        handleClick({ currentTarget: liEl }, index);
      }
    }
  };

  useEffect(() => {
    if (!navRef.current || !containerRef.current) return;
    const activeLi = navRef.current.querySelectorAll('li')[activeIndex];
    if (activeLi) {
      updateEffectPosition(activeLi, containerRef.current, filterRef.current, textRef.current);
      textRef.current?.classList.add('active');
    }

    const resizeObserver = new ResizeObserver(() => {
      const currentActiveLi = navRef.current?.querySelectorAll('li')[activeIndex];
      if (currentActiveLi) {
        updateEffectPosition(currentActiveLi, containerRef.current, filterRef.current, textRef.current);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [activeIndex]);

  return (
    <div className="gooey-nav-container" ref={containerRef}>
      <nav>
        <ul ref={navRef}>
          {items.map((item, index) => (
            <li key={index} className={activeIndex === index ? 'active' : ''}>
              <a href={item.href} onClick={e => handleClick(e, index)} onKeyDown={e => handleKeyDown(e, index)}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <span className="effect filter" ref={filterRef} />
      <span className="effect text" ref={textRef} />
    </div>
  );
};

export default GooeyNav;
