import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyDlp_b-jKX3H34SwjEuKf34YOANMUKuVY4",
    authDomain: "jms-ffl.firebaseapp.com",
    projectId: "jms-ffl",
    storageBucket: "jms-ffl.firebasestorage.app",
    messagingSenderId: "1042863834836",
    appId: "1:1042863834836:web:31d8dfe6c4542382cc1d41",
    measurementId: "G-CM1KETWBH4"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app, "https://jms-ffl-default-rtdb.firebaseio.com/");