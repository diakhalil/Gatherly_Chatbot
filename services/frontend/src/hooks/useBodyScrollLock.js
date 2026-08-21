import { useEffect } from "react";

const LOCK_ATTR = "data-scroll-lock-count";
const PREV_OVERFLOW_ATTR = "data-prev-overflow";

const getLockCount = (body) => Number(body.getAttribute(LOCK_ATTR)) || 0;

const setLockCount = (body, count) => {
  if (count <= 0) {
    body.removeAttribute(LOCK_ATTR);
  } else {
    body.setAttribute(LOCK_ATTR, String(count));
  }
};

export default function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active || typeof document === "undefined") {
      return undefined;
    }
    const body = document.body;
    const currentCount = getLockCount(body);
    if (currentCount === 0) {
      body.setAttribute(PREV_OVERFLOW_ATTR, body.style.overflow || "");
      body.style.overflow = "hidden";
    }
    setLockCount(body, currentCount + 1);

    return () => {
      const nextCount = getLockCount(body) - 1;
      if (nextCount <= 0) {
        const previous = body.getAttribute(PREV_OVERFLOW_ATTR) || "";
        body.style.overflow = previous;
        body.removeAttribute(PREV_OVERFLOW_ATTR);
        setLockCount(body, 0);
      } else {
        setLockCount(body, nextCount);
      }
    };
  }, [active]);
}

