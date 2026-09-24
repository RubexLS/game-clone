import { renderBoard } from './ui/render.js';
import { Player, drawPlayerToken } from './core/player.js';
import { loginAnonymously } from './services/auth.js';
import { createGameRoom, syncPlayerToRoom, listenToRoom, updateDiceResult, buyPropertyInCloud, endTurnInCloud, getRoomSnapshot, payRentInCloud } from './services/network.js';
import { GameManager } from './core/game.js';
import { getSquareById } from './core/board.js';

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
    const modalPropertyName = document.getElementById('modal-property-name');
    const modalPropertyPrice = document.getElementById('modal-property-price');

    // Captura de elementos de la nueva Ventana Modal (Añadir al inicio del DOMContentLoaded)
    const buyModal = document.getElementById('buy-property-modal');
    const modalName = document.getElementById('modal-property-name');
    const modalPrice = document.getElementById('modal-property-price');
    const btnConfirmBuy = document.getElementById('btn-confirm-buy');
    const btnDeclineBuy = document.getElementById('btn-decline-buy');

    // LÓGICA DE CONEXIÓN (LOBBY)

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
            const roomData = await getRoomSnapshot(roomCode);

            if (!roomData) { 
                alert( `La sala "${roomCode}" no existe. ` + `Verifica el código e inténtalo nuevamente.` ); 
                return; 
            }

            if (roomData.meta?.status !== "waiting") {
                alert( "Esta partida ya comenzó y no permite nuevos jugadores." ); 
                return; 
            }

            const currentPlayers = roomData.players || {};
            const playerCount = Object.keys(currentPlayers).length;

            if (playerCount >= 4) { 
                alert( "La sala ya tiene el máximo de 4 jugadores." );
                return; 
            }
            
            currentRoomId = roomCode;
            localPlayer = new Player(user.uid, username, selectedColor);
            
            await syncPlayerToRoom(currentRoomId, localPlayer);

            startSession();

        } catch (error) {
            console.error( "Error al unirse a la sala:", error );
            alert( "No fue posible unirse a la sala. " + "Revisa el código e inténtalo nuevamente." );
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

    // ESCUCHA Y SINCRONIZACIÓN EN TIEMPO REAL

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

        if (activeTurnUid === localPlayer.id && gameplay.turnStatus === "waiting-roll") {
            currentTurnInfo.textContent = "¡Es tu turno! Lanza los dados.";
            if (btnRollDice) btnRollDice.disabled = false;
            if (btnEndTurn) btnEndTurn.disabled = true;
        } else if (activeTurnUid === localPlayer.id && gameplay.turnStatus === "awaiting-end") {
            currentTurnInfo.textContent = "Turno en curso. Termina tu turno.";

            if (btnRollDice) btnRollDice.disabled = true;
            if (btnEndTurn) btnEndTurn.disabled = false;
        } else {

            const currentTurnName = cloudPlayers[activeTurnUid]?.name || "Otro jugador";
            currentTurnInfo.textContent = `Turno de: ${currentTurnName}`;

            if (btnRollDice) btnRollDice.disabled = true;
            if (btnEndTurn) btnEndTurn.disabled = true;
        }
    }

    // ACCIONES DE JUEGO (EVENTOS LOCALES -> ENVIAR A LA NUBE)

    btnRollDice?.addEventListener('click', async () => {

        if (!localPlayer || !currentRoomId) return;

        // Evitar múltiples lanzamientos mientras se procesa el turno
        btnRollDice.disabled = true;

        const die1 = Math.floor(Math.random() * 6) + 1;
        const die2 = Math.floor(Math.random() * 6) + 1;
        const total = die1 + die2;

        try {

            // Mover al jugador
            const passedGo = localPlayer.move(total);
            let message = `${localPlayer.name} sacó ${die1} y ${die2} ` + `(${total}) y avanzó a la casilla ${localPlayer.position}.`;

            // Informar si pasó por SALIDA
            if (passedGo) {
                message += " ¡Pasó por SALIDA y cobró $200!";
            }

            // Obtener la casilla donde aterrizó
            currentLandingSquare = getSquareById(localPlayer.position);

            if (!currentLandingSquare) {
                throw new Error(
                    `No se encontró la casilla ${localPlayer.position}.`
                );
            }

            // Guardar dados y movimiento en Firebase
            await updateDiceResult(
                currentRoomId,
                [die1, die2],
                message
            );

            // Sincronizar jugador
            await syncPlayerToRoom(
                currentRoomId,
                localPlayer
            );

            console.log( "Casilla de aterrizaje:", currentLandingSquare );

            // Comprobar si puede comprar la propiedad y si pertenece a otro jugador se cobra alquiler
            if ( gameManager.canBuyProperty( currentLandingSquare, localPlayer ) ) {
                modalPropertyName.textContent = currentLandingSquare.name;
                modalPropertyPrice.textContent = `Precio: $${currentLandingSquare.price}`;
                buyModal.classList.remove('hidden');
            } else if ( gameManager.propertiesState[ currentLandingSquare.id ] ) {
                const propertyInfo =
                    gameManager.propertiesState[
                        currentLandingSquare.id
                    ];

                // No pagar alquiler al propio propietario
                if ( propertyInfo.ownerId !== localPlayer.id ) {

                    const propertyInfo = gameManager.propertiesState[ currentLandingSquare.id ];

                    // El propietario no paga alquiler a sí mismo
                    if ( propertyInfo.ownerId !== localPlayer.id ) {

                        const rentCost = gameManager.calculateRent( currentLandingSquare );
                        const ownerId = propertyInfo.ownerId;
                        const rentMessage =
                            `${localPlayer.name} pagó ` +
                            `$${rentCost} de alquiler a ` +
                            `${ownerId} por ` +
                            `${currentLandingSquare.name}.`;

                        await payRentInCloud(
                            currentRoomId,
                            localPlayer.id,
                            ownerId,
                            rentCost,
                            rentMessage
                        );
                    }
                }
            }

            // 9. Después de resolver la casilla,
            //    permitir terminar el turno.
            if (btnEndTurn) {
                btnEndTurn.disabled = false;
            }

        } catch (error) {

            console.error(
                "Error durante el lanzamiento:",
                error
            );

            // Si ocurrió un error, permitir intentar nuevamente
            btnRollDice.disabled = false;

            alert(
                "Ocurrió un error durante el turno."
            );
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
