import { auth } from '../config/firebase.js';
import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

/**
 * Se autentica al usuario de forma anónima en Firebase.
 * @returns {Promise<User>} Promesa que resuelve con los datos del usuario autenticado.
 */
export async function loginAnonymously() {
    try{
        const result = await signInAnonymously(auth);

        console.log(
            "Autenticación completada con éxito anónimo. UID:", 
            result.user.uid
        );
        return result.user;
    }catch(error){
        console.error(
            "Error durante la autenticación anónima:", 
            error
        );
        throw error;
    }
}

/**
 * Se registra un observador para detectar cambios en el estado de la sesión.
 * @param {Function} callback - Función ejecutada cada vez que el usuario inicia o cierra sesión.
 */
export function monitorAuthState(callback) {
    onAuthStateChanged(auth, (user) => {
        callback(user);
    });
}