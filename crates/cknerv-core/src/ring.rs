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
            inner: Mutex::new(VecDeque::with_capacity(cap)),
            cap,
        }
    }

    pub fn push(&self, item: T) {
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

    pub fn capacity(&self) -> usize {
        self.cap
    }
}
