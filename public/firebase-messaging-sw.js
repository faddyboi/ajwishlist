// Firebase Messaging Service Worker
// Runs in the background to receive push notifications when app is closed

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDqCiKBERSp_ybqTPgHKGogW_uDywvwiDQ",
  authDomain: "jamie-andie-wishlist-claude.firebaseapp.com",
  projectId: "jamie-andie-wishlist-claude",
  storageBucket: "jamie-andie-wishlist-claude.firebasestorage.app",
  messagingSenderId: "377776890778",
  appId: "1:377776890778:web:4ea211b80a6fd9a367d023"
});

const messaging = firebase.messaging();

// This handles notifications when the app is in the BACKGROUND or CLOSED
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    vibrate: [200, 100, 200],
  });
});
