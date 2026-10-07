import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, query, orderBy, where, serverTimestamp, increment, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBfMEhIaroFjf3dOHAXnTeolwJdi2kEQyQ",
  authDomain: "futinder-cace8.firebaseapp.com",
  projectId: "futinder-cace8",
  storageBucket: "futinder-cace8.firebasestorage.app",
  messagingSenderId: "561463769028",
  appId: "1:561463769028:web:f1b6e59383f0032cdd1691"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();


// Configuración pública del cliente; los permisos se definen en las reglas de Firebase.
export { initializeApp, getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDoc, query, orderBy, where, serverTimestamp, increment, arrayUnion, arrayRemove, getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, getStorage, ref, uploadBytes, getDownloadURL, deleteObject, firebaseConfig, app, db, auth, storage, provider };
