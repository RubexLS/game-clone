import { renderBoard } from './ui/render.js';
import { Player, drawPlayerToken } from './core/player.js';
import { loginAnonymously } from './services/auth.js';
import { createGameRoom, syncPlayerToRoom, listenToRoom, updateDiceAndTurn, buyPropertyInCloud, endTurnInCloud, getRoomSnapshot } from './services/network.js';
import { GameManager } from './core/game.js';
import { getSquareById } from './core/board.js'; // Importante para leer los datos de la casilla actual

// Variables globales para la sesión del jugador local
let localPlayer = null;
let currentRoomId = null;
let activePlayersList = {}; // Guarda las instancias locales de todos los jugadores de la sala
const gameManager = new GameManager(); // Instancia para manejar las reglas de compra
// Variable temporal para recordar qué casilla estamos evaluando comprar
    let currentLandingSquare = null;
const btnEndTurn = document.getElementById('btn-end-turn');

document.addEventListener('DOMContentLoaded', () => {
    console.log("Inicializando Motor Multijugador de Monopoly...");

    // 1. Capturar elementos de la pantalla del Lobby
    const lobbyScreen = document.getElementById('lobby-screen');
    const gameContainer = document.getElementById('game-container');
    const inputUsername = document.getElementById('lobby-username');
    const selectColor = document.getElementById('lobby-color');
    const inputRoom = document.getElementById('lobby-room');
    const btnCreateRoom = document.getElementById('btn-create-room');
    const btnJoinRoom = document.getElementById('btn-join-room');

    // 2. Capturar elementos del panel de juego
    const btnRollDice = document.getElementById('btn-roll-dice');
    const diceView = document.getElementById('dice-view');
    const logMessages = document.getElementById('log-messages');
    const currentTurnInfo = document.getElementById('current-turn-info');
    const playersListUI = document.getElementById('players-list');

    // Captura de elementos de la nueva Ventana Modal (Añadir al inicio del DOMContentLoaded)
    const buyModal = document.getElementById('buy-property-modal');
    const modalName = document.getElementById('modal-property-name');
    const modalPrice = document.getElementById('modal-property-price');
    const btnConfirmBuy = document.getElementById('btn-confirm-buy');
    const btnDeclineBuy = document.getElementById('btn-decline-buy');

    // ==========================================
    // LÓGICA DE CONEXIÓN (LOBBY)
    // ==========================================

    // Evento para CREAR una nueva sala en la nube
    btnCreateRoom?.addEventListener('click', async () => {
        const username = inputUsername.value.trim();
        const roomCode = inputRoom.value.trim().toUpperCase();
        const selectedColor = selectColor.value;

        if (!username || !roomCode) {
            alert("Por favor, ingresa tu nombre y un código de sala.");
            return;
        }

        try {
            // Autenticación anónima en Firebase
            const user = await loginAnonymously();
            currentRoomId = roomCode;

            // Inicializar la sala en Realtime Database
            await createGameRoom(currentRoomId, user.uid);

            // Crear el objeto del jugador local
            localPlayer = new Player(user.uid, username, selectedColor);

            // Guardar al jugador dentro de la sala en Firebase
            await syncPlayerToRoom(currentRoomId, localPlayer);

            // Cambiar de pantalla e iniciar el tablero
            startSession();

        } catch (error) {
            alert("Error al crear la sala de juego. Revisa la consola.");
        }
    });

    // Evento para UNIRSE a una sala ya existente
    btnJoinRoom?.addEventListener('click', async () => {
        const username = inputUsername.value.trim();
        const roomCode = inputRoom.value.trim().toUpperCase();
        const selectedColor = selectColor.value;

        if (!username || !roomCode) {
            alert("Por favor, ingresa tu nombre y un código de sala.");
            return;
        }

        try {
            const user = await loginAnonymously();
            currentRoomId = roomCode;

            localPlayer = new Player(user.uid, username, selectedColor);
            
            // Sincronizar directo en la ruta de la sala ingresada
            await syncPlayerToRoom(currentRoomId, localPlayer);

            startSession();

        } catch (error) {
            alert("Error al unirse a la sala. Verifica el código.");
        }
    });

    // Función intermedia para limpiar pantallas e inicializar oyentes
    function startSession() {
        lobbyScreen.classList.add('hidden');
        gameContainer.classList.remove('hidden');
        
        // Renderizamos las casillas en la interfaz
        renderBoard();

        // Activamos la escucha en tiempo real de Firebase para esta sala específica
        listenToRoom(currentRoomId, (roomData) => {
            if (roomData) {
                handleRoomUpdate(roomData);
            }
        });
    }

    // ==========================================
    // ESCUCHA Y SINCRONIZACIÓN EN TIEMPO REAL
    // ==========================================

    function handleRoomUpdate(roomData) {
        const cloudPlayers = roomData.players || {};
        const gameplay = roomData.gameplay || {};

        // Sincronizar el registro de compras con nuestro gestor de reglas local
        gameManager.propertiesState = roomData.properties || {};

        // Limpiar contenedores visuales para redibujar el estado fresco de la nube
        playersListUI.innerHTML = "";
        
        // 1. Sincronizar y dibujar a todos los jugadores conectados en la sala
        Object.keys(cloudPlayers).forEach((uid) => {
            const pData = cloudPlayers[uid];

            // Reconstruir o actualizar la instancia local del jugador
            if (!activePlayersList[uid]) {
                activePlayersList[uid] = new Player(pData.id, pData.name, pData.color);
            }
            
            // Sincronizar los valores numéricos cambiantes desde Firebase
            activePlayersList[uid].position = pData.position;
            activePlayersList[uid].money = pData.money;
            activePlayersList[uid].isJailed = pData.isJailed;

            // Renderizar la tarjeta del jugador en el panel lateral izquierdo
            const playerCard = document.createElement('div');
            playerCard.style.borderLeft = `5px solid ${pData.color}`;
            playerCard.style.padding = "5px";
            playerCard.style.marginBottom = "5px";
            playerCard.style.backgroundColor = "#2c3e50";
            playerCard.innerHTML = `<strong>${pData.name}</strong>: $${pData.money} (Casilla ${pData.position})`;
            playersListUI.appendChild(playerCard);

            // Dibujar la ficha en la casilla correspondiente del tablero
            drawPlayerToken(activePlayersList[uid]);
        });

        // 2. Sincronizar visualmente los dados si cambiaron en la base de datos
        if (gameplay.dice && gameplay.dice.length === 2) {
            const total = gameplay.dice[0] + gameplay.dice[1];
            if (total > 0) {
                diceView.textContent = `🎲 ${gameplay.dice[0]}  🎲 ${gameplay.dice[1]} (Total: ${total})`;
            }
        }

        // 3. Imprimir la última acción registrada en el historial
        if (gameplay.lastAction) {
            const log = document.createElement('p');
            log.textContent = gameplay.lastAction;
            logMessages.appendChild(log);
            logMessages.scrollTop = logMessages.scrollHeight;
        }

        // 4. Gestión elemental del turno (Habilitar botones solo al jugador correspondiente)
        const btnEndTurn = document.getElementById('btn-end-turn');
        const playerUidsOrder = Object.keys(cloudPlayers);
        const activeTurnUid = playerUidsOrder[gameplay.currentTurnIndex];

        if (activeTurnUid === localPlayer.id) {
            currentTurnInfo.textContent = "¡Es tu turno! Lanza los dados.";
            if (btnRollDice) btnRollDice.disabled = false;
        } else {
            const currentTurnName = cloudPlayers[activeTurnUid]?.name || "Otro jugador";
            currentTurnInfo.textContent = `Turno de: ${currentTurnName}`;
            if (btnRollDice) btnRollDice.disabled = true;
            if (btnEndTurn) btnEndTurn.disabled = true;
        }
    }

    // ==========================================
    // ACCIONES DE JUEGO (EVENTOS LOCALES -> ENVIAR A LA NUBE)
    // ==========================================

    btnRollDice?.addEventListener('click', async () => {

        // Bloquear el botón temporalmente para evitar doble clic accidental
        btnRollDice.disabled = true;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;

        // Mover la lógica del jugador local de manera interna
        const passedGo = localPlayer.move(total);

        // Armar el mensaje de historial
        let message = `${localPlayer.name} sacó ${total} y avanzó a la casilla ${localPlayer.position}.`;
        if (passedGo) {
            message += " ¡Pasó por SALIDA y cobró \$200!";
        }

        try {
            await updateDiceAndTurn(currentRoomId, [die1, die2], message);
            await syncPlayerToRoom(currentRoomId, localPlayer);

            // EVALUAR CASILLA DE ATERRIZAJE
            currentLandingSquare = getSquareById(localPlayer.position);

            // Si la propiedad está libre y tenemos dinero, abrimos la ventana de compra
            if (gameManager.canBuyProperty(currentLandingSquare, localPlayer)) {
                modalName.textContent = currentLandingSquare.name;
                modalPrice.textContent = `Precio: $${currentLandingSquare.price}`;
                buyModal.classList.remove('hidden');
            } else if (gameManager.propertiesState[currentLandingSquare.id]) {
                // Lógica básica de Alquiler: Si ya tiene dueño y no somos nosotros
                const propertyInfo = gameManager.propertiesState[currentLandingSquare.id];
                if (propertyInfo.ownerId !== localPlayer.id) {
                    const rentCost = gameManager.calculateRent(currentLandingSquare);
                    localPlayer.money -= rentCost;

                    const rentMessage = `${localPlayer.name} cayó en la propiedad de un rival y pagó $${rentCost} de alquiler.`;
                    await updateDiceAndTurn(currentRoomId, [die1, die2], rentMessage);
                    await syncPlayerToRoom(currentRoomId, localPlayer);
                }
            }
            const btnEndTurn = document.getElementById('btn-end-turn');
            if (btnEndTurn) btnEndTurn.disabled = false;
        } catch (err) {
            console.error("Error al actualizar la jugada:", err);
            btnRollDice.disabled = false;
        }
    });


    // Acciones de los botones de la Ventana Flotante de Compra
    btnConfirmBuy?.addEventListener('click', async () => {
        if (!currentLandingSquare || !localPlayer) return;

        // Restar dinero localmente e indexar ID de la propiedad comprada
        localPlayer.money -= currentLandingSquare.price;
        if (!localPlayer.properties) localPlayer.properties = [];
        localPlayer.properties.push(currentLandingSquare.id);

        const buyMessage = `¡${localPlayer.name} compró ${currentLandingSquare.name} por $${currentLandingSquare.price}!`;

        // Subir compra e historial a la nube simultáneamente
        await buyPropertyInCloud(currentRoomId, currentLandingSquare.id, localPlayer.id, buyMessage);
        await syncPlayerToRoom(currentRoomId, localPlayer);

        buyModal.classList.add('hidden'); // Ocultar cuadro
    });

    btnDeclineBuy?.addEventListener('click', () => {
        buyModal.classList.add('hidden'); // Simplemente cierra la ventana si decide pasar
    });

    const btnEndTurn = document.getElementById('btn-end-turn');
    btnEndTurn?.addEventListener('click', async () => {
        if (btnEndTurn.disabled) return;
        btnEndTurn.disabled = true;

        try {
            // Llamamos a nuestra función de red limpia sin importar ref ni get aquí
            const roomData = await getRoomSnapshot(currentRoomId);
            
            if (roomData) {
                const playerUidsOrder = Object.keys(roomData.players || {});
                const gameplay = roomData.gameplay || {};

                // Calculamos el índice del siguiente jugador de forma circular
                const nextTurnIndex = (gameplay.currentTurnIndex + 1) % playerUidsOrder.length;
                
                const nextPlayerName = roomData.players[playerUidsOrder[nextTurnIndex]]?.name || "Siguiente jugador";
                const endTurnMessage = `--- ${localPlayer.name} terminó su turno. Ahora es el turno de ${nextPlayerName}. ---`;

                // Enviamos el nuevo índice a Firebase
                await endTurnInCloud(currentRoomId, nextTurnIndex, endTurnMessage);
            }
        } catch (err) {
            console.error("Error al pasar el turno:", err);
            btnEndTurn.disabled = false;
        }
    });
});
