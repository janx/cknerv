//! Bounded ring buffer for `/api/events` style replay.
//!
//! Push-evicts-oldest; `snapshot` returns a cloned `Vec<T>` of at most
//! `cap` items in insertion order.

use std::collections::VecDeque;
use std::sync::Mutex;

pub struct Ring<T> {
    inner: Mutex<VecDeque<T>>,
    cap: usize,
}

impl<T: Clone> Ring<T> {
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            // Keep the logical cap without eagerly reserving tens of thousands
            // of entries. Most fresh/restarted servers need only a small live
            // suffix, and replay barriers compact historical segments.
            inner: Mutex::new(VecDeque::new()),
            cap,
        }
    }

    pub fn push(&self, item: T) {
        if self.cap == 0 {
            return;
        }
        let mut g = self.inner.lock().unwrap();
        if g.len() >= self.cap {
            g.pop_front();
        }
        g.push_back(item);
    }

    pub fn snapshot(&self) -> Vec<T> {
        let g = self.inner.lock().unwrap();
        g.iter().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().unwrap().is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.cap
    }

    /// Drop every retained entry while keeping the current allocation for the
    /// next short replay segment.
    pub fn clear(&self) {
        self.inner.lock().unwrap().clear();
    }

    /// Drop entries and release their backing allocation. Used at terminal
    /// replay barriers so boot-only capacity does not remain in steady-state
    /// RSS.
    pub fn clear_and_shrink(&self) {
        *self.inner.lock().unwrap() = VecDeque::new();
    }
}

#[cfg(test)]
mod tests {
    use super::Ring;

    #[test]
    fn clear_preserves_logical_capacity_and_accepts_new_entries() {
        let ring = Ring::with_capacity(2);
        ring.push(1);
        ring.push(2);
        ring.clear();
        assert!(ring.is_empty());
        assert_eq!(ring.capacity(), 2);
        ring.push(3);
        assert_eq!(ring.snapshot(), vec![3]);
        ring.clear_and_shrink();
        assert!(ring.is_empty());
    }

    #[test]
    fn zero_capacity_ring_never_retains_an_entry() {
        let ring = Ring::with_capacity(0);
        ring.push(1);
        assert!(ring.is_empty());
    }
}
