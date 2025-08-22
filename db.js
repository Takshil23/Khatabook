// Unified data adapter: Firestore (if configured) with localStorage fallback
// Exposes window.DB with: saveOrder, getOrders, updateOrder, deleteOrder, clearAll, subscribeOrders

(function () {
  const LOCAL_STORAGE_KEY = 'khataBookOrders';

  function loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      // Ensure each order has an id
      return parsed.map((o) => ({ id: o.id || generateId(), ...o }));
    } catch (e) {
      return [];
    }
  }

  function saveToLocalStorage(orders) {
    try {
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(
          orders.map(({ id, ...rest }) => ({ id, ...rest }))
        )
      );
    } catch (e) {
      // no-op
    }
  }

  function generateId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
    );
  }

  const hasFirebase = typeof window !== 'undefined' && typeof window.firebase !== 'undefined';
  const hasConfig = typeof window !== 'undefined' && !!window.FIREBASE_CONFIG;
  let firestore = null;
  let cloudEnabled = false;

  if (hasFirebase && hasConfig) {
    try {
      if (window.firebase.apps && window.firebase.apps.length === 0) {
        window.firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      firestore = window.firebase.firestore();
      cloudEnabled = !!firestore;
    } catch (e) {
      firestore = null;
      cloudEnabled = false;
    }
  }

  async function saveOrder(order) {
    const orderToSave = { ...order };
    if (firestore) {
      try {
        const now = window.firebase.firestore.FieldValue.serverTimestamp();
        const uid = (window.firebase.auth && window.firebase.auth().currentUser && window.firebase.auth().currentUser.uid) || null;
        orderToSave.createdAt = now;
        orderToSave.updatedAt = now;
        if (uid) {
          orderToSave.createdBy = uid;
          orderToSave.updatedBy = uid;
        }
        const docRef = await firestore.collection('orders').add(orderToSave);
        return { id: docRef.id, ...order };
      } catch (e) {
        // Fall back to local storage on any Firestore error (e.g., auth not enabled or rules)
        console.warn('Firestore save failed; falling back to localStorage', e);
        cloudEnabled = false; if (window.DB) window.DB.isCloud = false;
      }
    }
    // Fallback: localStorage
    const orders = loadFromLocalStorage();
    const id = orderToSave.id || generateId();
    const withMeta = { id, ...orderToSave, createdAt: orderToSave.createdAt || new Date().toISOString() };
    orders.unshift(withMeta);
    saveToLocalStorage(orders);
    return withMeta;
  }

  async function getOrders() {
    if (firestore && cloudEnabled) {
      try {
        const snapshot = await firestore
          .collection('orders')
          .orderBy('createdAt', 'desc')
          .get();
        return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch (e) {
        console.warn('Firestore getOrders failed; using localStorage', e);
        cloudEnabled = false; if (window.DB) window.DB.isCloud = false;
      }
    }
    // Fallback
    const orders = loadFromLocalStorage();
    // Sort by createdAt desc if present
    orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return orders;
  }

  function subscribeOrders(callback) {
    function startPolling() {
      let lastSerialized = null;
      const intervalId = setInterval(() => {
        const nowOrders = loadFromLocalStorage();
        const serialized = JSON.stringify(nowOrders);
        if (serialized !== lastSerialized) {
          lastSerialized = serialized;
          const sorted = [...nowOrders].sort(
            (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
          );
          callback(sorted);
        }
      }, 2000);
      return () => clearInterval(intervalId);
    }

    if (firestore && cloudEnabled) {
      try {
        let stopPolling = null;
        const unsubscribe = firestore
          .collection('orders')
          .orderBy('createdAt', 'desc')
          .onSnapshot(
            (snapshot) => {
              const orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
              callback(orders);
            },
            (error) => {
              console.warn('Firestore subscribe failed; switching to local polling', error);
              cloudEnabled = false; if (window.DB) window.DB.isCloud = false;
              if (!stopPolling) stopPolling = startPolling();
            }
          );
        return () => {
          try { unsubscribe && unsubscribe(); } catch (e) {}
          if (stopPolling) stopPolling();
        };
      } catch (e) {
        console.warn('Firestore subscribe exception; switching to local polling', e);
        cloudEnabled = false; if (window.DB) window.DB.isCloud = false;
        return startPolling();
      }
    }
    // Fallback polling
    return startPolling();
  }

  async function updateOrder(id, updates) {
    if (firestore && cloudEnabled) {
      try {
        const now = window.firebase.firestore.FieldValue.serverTimestamp();
        const uid = (window.firebase.auth && window.firebase.auth().currentUser && window.firebase.auth().currentUser.uid) || null;
        const payload = { ...updates, updatedAt: now };
        if (uid) payload.updatedBy = uid;
        await firestore.collection('orders').doc(id).update(payload);
        return;
      } catch (e) {
        console.warn('Firestore update failed; updating localStorage', e);
        cloudEnabled = false; if (window.DB) window.DB.isCloud = false;
      }
    }
    const orders = loadFromLocalStorage();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx !== -1) {
      orders[idx] = { ...orders[idx], ...updates };
      saveToLocalStorage(orders);
    }
  }

  async function deleteOrder(id) {
    if (firestore && cloudEnabled) {
      try {
        await firestore.collection('orders').doc(id).delete();
        return;
      } catch (e) {
        console.warn('Firestore delete failed; deleting from localStorage', e);
        cloudEnabled = false; if (window.DB) window.DB.isCloud = false;
      }
    }
    const orders = loadFromLocalStorage();
    const next = orders.filter((o) => o.id !== id);
    saveToLocalStorage(next);
  }

  async function clearAll() {
    if (firestore && cloudEnabled) {
      try {
        const snapshot = await firestore.collection('orders').get();
        const batch = firestore.batch();
        snapshot.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        return;
      } catch (e) {
        console.warn('Firestore clearAll failed; clearing localStorage', e);
        cloudEnabled = false; if (window.DB) window.DB.isCloud = false;
      }
    }
    saveToLocalStorage([]);
  }

  window.DB = {
    saveOrder,
    getOrders,
    subscribeOrders,
    updateOrder,
    deleteOrder,
    clearAll,
    isCloud: cloudEnabled,
  };
})();


