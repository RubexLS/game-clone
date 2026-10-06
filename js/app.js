import { renderBoard } from './ui/render.js';
import { Player, drawPlayerToken } from './core/player.js';
import { loginAnonymously } from './services/auth.js';
import { createGameRoom, syncPlayerToRoom, listenToRoom, updateDiceResult, buyPropertyInCloud, endTurnInCloud, getRoomSnapshot, payRentInCloud, payTaxInCloud, setTurnStatus, sendPlayerToJailInCloud, payJailFineInCloud, useJailCardInCloud, registerJailAttemptInCloud, buildHouseInCloud, buildHotelInCloud, handleBankruptcyInCloud, mortgagePropertyInCloud, unmortgagePropertyInCloud } from './services/network.js';
import { GameManager } from './core/game.js';
import { BOARD_SQUARES, getSquareById } from './core/board.js';
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS, CardDeck, applyBasicCardEffect, applyPlayerInteractionCardEffect, applySpecialCardEffect } from './core/cards.js';

// Variables globales para la sesión del jugador local
let localPlayer = null;
let currentRoomId = null;
let stopRoomListener = null;
let activePlayersList = {}; // Guarda las instancias locales de todos los jugadores de la sala
let lastDisplayedAction = "";
const gameManager = new GameManager(); // Instancia para manejar las reglas de compra
const chanceDeck = new CardDeck(CHANCE_CARDS);
const communityChestDeck = new CardDeck(COMMUNITY_CHEST_CARDS);
// Variable temporal para recordar qué casilla estamos evaluando comprar
let currentLandingSquare = null;
const btnEndTurn = document.getElementById('btn-end-turn');

function drawCardForSquare(square) {
    if (square.type === "chance") return chanceDeck.drawCard();
    if (square.type === "community-chest") return communityChestDeck.drawCard();
    return null;
}

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
    const btnBuildHouse = document.getElementById('btn-build-house');
    const btnBuildHotel = document.getElementById('btn-build-hotel');
    const btnMortgageProperty = document.getElementById('btn-mortgage-property');
    const btnUnmortgageProperty = document.getElementById('btn-unmortgage-property');

    const jailPanel = document.createElement('div');
    jailPanel.id = 'jail-panel';
    jailPanel.classList.add('hidden');
    jailPanel.innerHTML = `
        <div class="jail-title">
            🚔 ESTÁS EN LA CÁRCEL
        </div>

        <div id="jail-status"></div>

        <button id="btn-jail-pay">
            💵 Pagar $50 y salir
        </button>

        <button id="btn-jail-card">
            🎟️ Usar carta para salir
        </button>
    `;
    gameContainer.appendChild(jailPanel);
    const jailStatus = document.getElementById('jail-status');
    const btnJailPay = document.getElementById('btn-jail-pay');
    const btnJailCard = document.getElementById('btn-jail-card');

    const cardModal = document.getElementById('card-modal');
    const cardModalTitle = document.getElementById('card-modal-title');
    const cardModalText = document.getElementById('card-modal-text');
    const btnAcceptCard = document.getElementById('btn-accept-card');
    let currentCard = null;

    const gameWinnerMessage = document.getElementById('game-winner-message');
    const winnerNameElement = document.getElementById('winner-name');
    const btnBackToLobby = document.getElementById('btn-back-to-lobby');

    // LÓGICA DE CONEXIÓN (LOBBY)

    btnBackToLobby?.addEventListener('click', () => {
        // Ocultar mensaje de ganador
        gameWinnerMessage?.classList.add('hidden');

        // Mostrar lobby
        const lobbyScreen = document.getElementById('lobby-screen');
        if (lobbyScreen) lobbyScreen.classList.remove('hidden');

        // Ocultar tablero
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) gameContainer.classList.add('hidden');

        if (stopRoomListener) {
            stopRoomListener();
            stopRoomListener = null;
        }

        // Limpiar estado local
        localPlayer = null;
        currentRoomId = null;
        currentLandingSquare = null;
        activePlayersList = {};

        // Restablecer controles
        if (btnRollDice) btnRollDice.disabled = false;
        if (btnEndTurn) btnEndTurn.disabled = true;
    });

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
            console.error(
                "ERROR REAL AL CREAR LA SALA:",
                error
            );
        
            alert(
                "Error al crear la sala: " +
                (error?.message || error)
            );
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
        stopRoomListener = listenToRoom(currentRoomId, (roomData) => {
            if (roomData) {
                handleRoomUpdate(roomData);
            }
        });
    }

    // ESCUCHA Y SINCRONIZACIÓN EN TIEMPO REAL

    function handleRoomUpdate(roomData) {
        const cloudPlayers = roomData.players || {};
        const gameplay = roomData.gameplay || {};
        const gameFinished = roomData.meta?.status === "finished";

        if (gameFinished) {
            if (btnRollDice) btnRollDice.disabled = true;
            if (btnEndTurn) btnEndTurn.disabled = true;
            if (buyModal) buyModal.classList.add('hidden');
            if (gameWinnerMessage) gameWinnerMessage.classList.remove('hidden');
            if (winnerNameElement) winnerNameElement.textContent = `🏆 ${roomData.meta?.winnerName || "Jugador desconocido"} ha ganado la partida.`;

            return;
        }

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
            activePlayersList[uid].jailTurns = pData.jailTurns || 0;
            activePlayersList[uid].getOutOfJailFreeCards = pData.getOutOfJailFreeCards || 0;
            // Obtener las propiedades realmente pertenecientes al jugador
            const playerProperties = [];

            Object.keys(roomData.properties || {}).forEach((propertyId) => {
                const propertyData = roomData.properties[propertyId];
            
                if (propertyData.ownerId === uid) {
                    playerProperties.push(Number(propertyId));
                }
            });

            activePlayersList[uid].properties = playerProperties;

            // Renderizar la tarjeta del jugador en el panel lateral izquierdo
            const playerCard = document.createElement('div');
            playerCard.style.borderLeft = `5px solid ${pData.color}`;
            playerCard.style.padding = "5px";
            playerCard.style.marginBottom = "5px";
            playerCard.style.backgroundColor = "#aec1d4";
            playerCard.innerHTML = `<strong>${pData.name}</strong>: $${pData.money} (Casilla ${pData.position})`;
            playersListUI.appendChild(playerCard);

            // Dibujar la ficha en la casilla correspondiente del tablero
            drawPlayerToken(activePlayersList[uid]);
        });
        renderPropertyBuildings();
        renderMyProperties();

        // Gestión elemental del turno (Habilitar botones solo al jugador correspondiente)
        const btnEndTurn = document.getElementById('btn-end-turn');
        const playerUidsOrder = Object.keys(cloudPlayers);
        const activeTurnUid = playerUidsOrder[gameplay.currentTurnIndex];

        // 2. Sincronizar visualmente los dados si cambiaron en la base de datos
        if (gameplay.dice && gameplay.dice.length === 2) {
            const total = gameplay.dice[0] + gameplay.dice[1];
            if (total > 0) {
                diceView.textContent = `🎲 ${gameplay.dice[0]}  🎲 ${gameplay.dice[1]} (Total: ${total})`;
            }
        }

        // 3. Imprimir la última acción registrada en el historial
        if (gameplay.lastAction && gameplay.lastAction !== lastDisplayedAction) {
            const logEntry = document.createElement('div');

            logEntry.textContent = gameplay.lastAction;
            logMessages.appendChild(logEntry);
            lastDisplayedAction = gameplay.lastAction;

            // Mantener solamente las últimas 10 jugadas
            while (logMessages.children.length > 10) {
                logMessages.removeChild( logMessages.firstElementChild );
            }

            // Mantener visible la jugada más reciente
            logMessages.scrollTop = logMessages.scrollHeight;
        }
        
        //opciones en la carcel
        if ( localPlayer && localPlayer.isJailed && activeTurnUid === localPlayer.id ) {
            jailPanel.classList.remove('hidden');
            const attempts = localPlayer.jailTurns || 0;

            jailStatus.textContent = `Intentos utilizados: ${attempts}/3. ` + `Puedes intentar sacar dobles.`;
            btnJailPay.disabled = localPlayer.money < 50;
            //btnJailCard.disabled = (localPlayer.getOutOfJailFreeCards || 0) <= 0;
            if (btnJailCard) {
                btnJailCard.disabled = (localPlayer.getOutOfJailFreeCards || 0) <= 0;
            }

        } else {
            jailPanel.classList.add('hidden');
        }

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

    function updatePropertyActionButtons() {
        if (!currentLandingSquare || !localPlayer) return;

        btnConfirmBuy?.classList.add('hidden');
        btnDeclineBuy?.classList.add('hidden');
        btnBuildHouse?.classList.add('hidden');
        btnBuildHotel?.classList.add('hidden');
        btnMortgageProperty?.classList.add('hidden');
        btnUnmortgageProperty?.classList.add('hidden');

        const propertyId = currentLandingSquare.id;
        const propertyInfo = gameManager.propertiesState?.[propertyId];

        // Propiedad sin dueño
        if (!propertyInfo) {
            if ( gameManager.canBuyProperty( currentLandingSquare, localPlayer ) ) {
                btnConfirmBuy?.classList.remove('hidden');
                btnDeclineBuy?.classList.remove('hidden');
            }
            return;
        }

        // La propiedad pertenece a otro jugador
        if (propertyInfo.ownerId !== localPlayer.id) return;

        // Edificios actuales de la propiedad
        const buildings = { houses: propertyInfo.houses || 0, hotel: propertyInfo.hotel || false };
        const mortgageValue = Math.floor( currentLandingSquare.price / 2 );

        // Propiedad ya hipotecada
        if (propertyInfo.mortgaged) {
            const unmortgageCost = Math.floor( mortgageValue * 1.10 );
            btnUnmortgageProperty.textContent = `🏦 Deshipotecar propiedad — pagar $${unmortgageCost}`;
        
            // Solo mostrar si tiene suficiente dinero
            if (localPlayer.money >= unmortgageCost) btnUnmortgageProperty?.classList.remove('hidden');
            return;
        }

        // Se puede hipotecar únicamente si no tiene edificios
        if (buildings.houses === 0 && !buildings.hotel) {
            btnMortgageProperty.textContent = `🏦 Hipotecar propiedad — recibir $${mortgageValue}`;
            btnMortgageProperty?.classList.remove('hidden');
        }

        // Ya tiene hotel
        if (buildings.hotel) return;

        // Tiene 4 casas: verificar si puede convertir a hotel
        if (buildings.houses >= 4) {
            const groupProperties = BOARD_SQUARES.filter(
                square =>
                    square.type === 'property' &&
                    square.group === currentLandingSquare.group
            );
            const allPropertiesHaveFourHouses = groupProperties.every(groupProperty => {
                const groupBuilding = gameManager.propertiesState?.[groupProperty.id];
                return (
                    groupBuilding &&
                    groupBuilding.ownerId === localPlayer.id &&
                    !groupBuilding.hotel &&
                    (groupBuilding.houses || 0) >= 4
                );
            });

            if (allPropertiesHaveFourHouses) {
                btnBuildHotel.textContent = `🏨 Construir hotel — $${currentLandingSquare.hotelCost}`;
                btnBuildHotel?.classList.remove('hidden');
            }
            return;
        }

        // Todavía puede construir una casa
        btnBuildHouse.textContent = `🏠 Construir casa — $${currentLandingSquare.houseCost}`;
        btnBuildHouse?.classList.remove('hidden');
    }

    function renderPropertyBuildings() {
        // Eliminar las construcciones visuales anteriores
        document
            .querySelectorAll('.property-buildings')
            .forEach(element => element.remove());

        const propertiesState = gameManager.propertiesState || {};

        Object.keys(propertiesState).forEach((propertyId) => {
            const propertyData = propertiesState[propertyId];

            if (!propertyData) return;

            const squareElement = document.querySelector(
                `[data-square-id="${propertyId}"]`
            );

            if (!squareElement) return;

            // Propiedad hipotecada
            if (propertyData.mortgaged) {
                const mortgageElement = document.createElement('div');
                mortgageElement.className = 'property-buildings';
                mortgageElement.textContent = '🏦';
                squareElement.appendChild( mortgageElement );
                return;
            }

            const houses = propertyData.houses || 0;
            const hotel = propertyData.hotel || false;

            // Hotel
            if (hotel) {
                const hotelElement = document.createElement('div');
                hotelElement.className = 'property-buildings';
                hotelElement.textContent = '🏨';
                squareElement.appendChild( hotelElement );
                return;
            }

            // Casas
            if (houses > 0) {
                const buildingsElement = document.createElement('div');
                buildingsElement.className = 'property-buildings';
                buildingsElement.textContent = '🏠'.repeat(houses);
                squareElement.appendChild( buildingsElement );
            }
        });
    }

    function renderMyProperties() {
        const propertiesList = document.getElementById('my-properties-list');

        if (!propertiesList || !localPlayer) return;

        propertiesList.innerHTML = '';

        const propertiesState = gameManager.propertiesState || {};

        const myProperties = Object.entries(propertiesState).filter(([propertyId, propertyData]) => {
                return propertyData && propertyData.ownerId === localPlayer.id;
        });

        if (myProperties.length === 0) {
            const emptyMessage = document.createElement('div');

            emptyMessage.textContent = 'No tienes propiedades.';

            emptyMessage.style.textAlign = 'center';
            emptyMessage.style.fontSize = '13px';
            emptyMessage.style.opacity = '0.7';

            propertiesList.appendChild(emptyMessage);
            return;
        }

        myProperties.forEach(([propertyId, propertyData]) => {
            const property = BOARD_SQUARES.find( square => square.id === Number(propertyId) );

            if (!property) return;

            const propertyElement = document.createElement('div');

            propertyElement.className = 'my-property-item';

            const houses = propertyData.houses || 0;
            const hotel = propertyData.hotel || false;
            const status = propertyData.mortgaged
                ? '🏦 Hipotecada'
                : hotel
                    ? '🏨 Hotel'
                    : houses > 0
                        ? `🏠 ${houses} casa${houses > 1 ? 's' : ''}`
                        : 'Sin construcciones';

            propertyElement.innerHTML = `
                <strong>${property.name}</strong>
                <div>💰 Valor: $${property.price}</div>
                <div>${status}</div>
            `;

            propertiesList.appendChild(propertyElement);
        });
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
            if (localPlayer.isJailed) {

                const doubles = die1 === die2;
                // Intento actual
                const currentAttempt = (localPlayer.jailTurns || 0) + 1;

                if (doubles) {
                    // Sacó dobles: sale de la cárcel
                    localPlayer.isJailed = false;
                    localPlayer.jailTurns = 0;

                    const oldPosition = localPlayer.position;
                    localPlayer.position = (oldPosition + total) % 40;
                    const passedGo = localPlayer.position < oldPosition;

                    if (passedGo) localPlayer.money += 200;

                    const message = `${localPlayer.name} sacó dobles ` + `(${die1} y ${die2}) y salió de la cárcel. ` + `Avanzó a la casilla ${localPlayer.position}.`;

                    await updateDiceResult(
                        currentRoomId,
                        [die1, die2],
                        message
                    );

                    await syncPlayerToRoom(
                        currentRoomId,
                        localPlayer
                    );

                    await setTurnStatus(
                        currentRoomId,
                        "awaiting-end"
                    );

                    console.log( "El jugador salió de la cárcel mediante dobles." );
                    return;
                }

                // No sacó dobles
                if (currentAttempt < 3) {

                    localPlayer.jailTurns = currentAttempt;

                    const message = `${localPlayer.name} intentó salir ` + `de la cárcel (${currentAttempt}/3) ` + `y no sacó dobles.`;

                    await registerJailAttemptInCloud(
                        currentRoomId,
                        localPlayer.id,
                        currentAttempt,
                        message
                    );

                    await setTurnStatus(
                        currentRoomId,
                        "awaiting-end"
                    );

                    return;
                }

                // Tercer intento sin dobles:
                // deberá pagar $50.
                localPlayer.jailTurns = 3;

                const message = `${localPlayer.name} agotó sus 3 intentos ` + `sin sacar dobles. Debe pagar $50 para salir.`;

                await registerJailAttemptInCloud(
                    currentRoomId,
                    localPlayer.id,
                    3,
                    message
                );

                await setTurnStatus(
                    currentRoomId,
                    "awaiting-end"
                );

                return;
            }

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

            const propertyInfo = gameManager.propertiesState[currentLandingSquare.id];
            const isOwnProperty = propertyInfo && propertyInfo.ownerId === localPlayer.id;
            const buildValidation = currentLandingSquare.type === 'property' ? 
                gameManager.canBuildOnProperty(
                    localPlayer,
                    currentLandingSquare.id
                ) : { allowed: false };
            const isBuildable = currentLandingSquare.type === 'property' && isOwnProperty && buildValidation.allowed;

            if ( currentLandingSquare.type === "chance" || currentLandingSquare.type === "community-chest" ) {
                currentCard = drawCardForSquare(currentLandingSquare);

                if (currentCard) {
                    const cardTitle = currentLandingSquare.type === "chance" ? "🎴 SUERTE" : "🎁 CAJA DE COMUNIDAD";
                    cardModalTitle.textContent = cardTitle;
                    cardModalText.textContent = currentCard.text;
                    cardModal.classList.remove('hidden');
                }
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

            // situaciones al caer en una casilla
            if (currentLandingSquare.type === "go-to-jail") {
                const jailMessage = `${localPlayer.name} cayó en ` + `${currentLandingSquare.name} ` + `y fue enviado a la cárcel.`;

                await sendPlayerToJailInCloud(
                    currentRoomId,
                    localPlayer.id,
                    jailMessage
                );

                // Actualizamos también la instancia local
                localPlayer.position = 10;
                localPlayer.isJailed = true;

                await setTurnStatus(
                    currentRoomId,
                    "awaiting-end"
                );
            } else if (currentLandingSquare.type === "tax") {
                const taxAmount = currentLandingSquare.cost;
                const taxMessage = `${localPlayer.name} pagó ` + `$${taxAmount} de impuesto ` + `por caer en ${currentLandingSquare.name}.`;

                await payTaxInCloud(
                    currentRoomId,
                    localPlayer.id,
                    taxAmount,
                    taxMessage
                );

                // El impuesto ya fue resuelto.y el jugador puede terminar su turno.
                await setTurnStatus(
                    currentRoomId,
                    "awaiting-end"
                );
            } else if ( gameManager.canBuyProperty( currentLandingSquare, localPlayer ) ) {
                modalName.textContent = currentLandingSquare.name;
                modalPrice.textContent = `Precio: $${currentLandingSquare.price}`;
                updatePropertyActionButtons();
                buyModal.classList.remove('hidden');
            } else if (isBuildable) {
                modalName.textContent = currentLandingSquare.name;
                modalPrice.textContent = `Propiedad propia | Casa: $${currentLandingSquare.houseCost} | Hotel: $${currentLandingSquare.hotelCost}`;
                updatePropertyActionButtons();
                buyModal.classList.remove('hidden');
            } else if (propertyInfo) {
                // La propiedad pertenece a otro jugador
                if (propertyInfo.ownerId !== localPlayer.id) {
                
                    const ownerId = propertyInfo.ownerId;
                
                    // Buscar al propietario entre los jugadores sincronizados
                    const ownerPlayer = activePlayersList[ownerId];
                
                    if (!ownerPlayer) {
                        console.warn(
                            "No se encontró al propietario de la propiedad:",
                            ownerId
                        );
                        return;
                    }
                
                    const diceTotal = die1 + die2;
                
                    const rentCost = gameManager.calculateRent(
                        currentLandingSquare,
                        ownerPlayer,
                        diceTotal
                    );
                
                    const rentMessage =
                        `${localPlayer.name} pagó ` +
                        `$${rentCost} de alquiler a ` +
                        `${ownerPlayer.name} por ` +
                        `${currentLandingSquare.name}.`;
                
                    const rentResult = await payRentInCloud(
                        currentRoomId,
                        localPlayer.id,
                        ownerId,
                        rentCost,
                        rentMessage
                    );

                    if (rentResult.bankrupt) {
                        const bankruptcyMessage = `¡${localPlayer.name} no pudo pagar ` + `el alquiler de $${rentCost}! ` + `Ha quedado en bancarrota.`;

                        await handleBankruptcyInCloud(
                            currentRoomId,
                            localPlayer.id,
                            ownerId,
                            bankruptcyMessage
                        );
                    
                        buyModal?.classList.add('hidden');
                        return;
                    }
                }
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

        const buyMessage = `¡${localPlayer.name} compró ` + `${currentLandingSquare.name} por ` + `$${currentLandingSquare.price}!`;
        
        try{
            // Subir compra e historial a la nube simultáneamente
            await buyPropertyInCloud(currentRoomId, currentLandingSquare.id, localPlayer.id, currentLandingSquare.price, buyMessage);
            buyModal.classList.add('hidden'); // Ocultar cuadro
        } catch (error) {
        console.error("Error al comprar la propiedad:", error);
        alert( "No se pudo completar la compra." );
        }
    });

    btnDeclineBuy?.addEventListener('click', () => {
        buyModal.classList.add('hidden'); // Simplemente cierra la ventana si decide pasar

        btnBuildHouse?.classList.add('hidden');
        btnBuildHotel?.classList.add('hidden');
    });

    btnBuildHouse?.addEventListener('click', async () => {
        if (!currentLandingSquare || !localPlayer) return;

        const propertyId = currentLandingSquare.id;
        const houseCost = currentLandingSquare.houseCost;
        const validation = gameManager.canBuildOnProperty( localPlayer, propertyId );

        if (!validation.allowed) {
            alert(validation.message);
            return;
        }

        // Verificar dinero disponible
        if (localPlayer.money < houseCost) {
            alert( `${localPlayer.name} no tiene suficiente dinero para construir una casa.` );
            return;
        }

        const buildMessage = `🏠 ${localPlayer.name} construyó una casa en ` + `${currentLandingSquare.name}.`;

        try {
            // Registrar la construcción en Firebase
            await buildHouseInCloud( currentRoomId, propertyId, localPlayer.id, houseCost, buildMessage );

            buyModal.classList.add('hidden');
        } catch (error) {
            console.error(
                "Error al construir la casa:",
                error
            );

            alert(
                "No se pudo construir la casa."
            );
        }
    });

    btnBuildHotel?.addEventListener('click', async () => {
        if (!currentLandingSquare || !localPlayer) return;

        const propertyId = currentLandingSquare.id;
        const hotelCost = currentLandingSquare.hotelCost;
        const validation = gameManager.canBuildOnProperty( localPlayer, propertyId );

        if (!validation.allowed) {
            alert(validation.message);
            return;
        }

        // Obtener el estado actual de la propiedad desde Firebase
        const propertyInfo = gameManager.propertiesState?.[propertyId];
        const buildings = {
            houses: propertyInfo?.houses || 0,
            hotel: propertyInfo?.hotel || false
        };

        // Debe tener 4 casas
        if (buildings.houses < 4) {
            alert( "Necesitas tener 4 casas antes de construir un hotel." );
            return;
        }

        // Verificar dinero
        if (localPlayer.money < hotelCost) {
            alert( `${localPlayer.name} no tiene suficiente dinero para construir un hotel.` );
            return;
        }

        const buildMessage = `🏨 ${localPlayer.name} construyó un hotel en ` + `${currentLandingSquare.name}.`;

        try {
            // Registrar hotel en Firebase
            await buildHotelInCloud( currentRoomId, propertyId, localPlayer.id, hotelCost, buildMessage );

            buyModal.classList.add('hidden');
        } catch (error) {

            console.error(
                "Error al construir el hotel:",
                error
            );
            alert( "No se pudo construir el hotel." );
        }
    });

    btnMortgageProperty?.addEventListener('click', async () => {
        if (!currentLandingSquare || !localPlayer) return;

        const propertyId = currentLandingSquare.id;
        const propertyInfo = gameManager.propertiesState?.[propertyId];

        // Verificar que la propiedad exista
        if (!propertyInfo) {
            alert("No se encontró la información de la propiedad.");
            return;
        }

        // Verificar que el jugador sea el propietario
        if (propertyInfo.ownerId !== localPlayer.id) {
            alert("No eres dueño de esta propiedad.");
            return;
        }

        // Verificar que no esté hipotecada
        if (propertyInfo.mortgaged) {
            alert("Esta propiedad ya está hipotecada.");
            return;
        }

        // Verificar que no tenga casas ni hotel
        const houses = propertyInfo.houses || 0;
        const hotel = propertyInfo.hotel || false;

        if (houses > 0 || hotel) {
            alert( "No puedes hipotecar una propiedad que tenga casas o hotel." );
            return;
        }

        // Valor de la hipoteca: 50% del precio de compra
        const mortgageValue = Math.floor( currentLandingSquare.price / 2 );

        const mortgageMessage = `🏦 ${localPlayer.name} hipotecó ` + `${currentLandingSquare.name} y recibió ` + `$${mortgageValue}.`;

        try {
            await mortgagePropertyInCloud(
                currentRoomId,
                propertyId,
                localPlayer.id,
                mortgageValue,
                mortgageMessage
            );

            buyModal.classList.add('hidden');

        } catch (error) {
            console.error( "Error al hipotecar la propiedad:", error );
            alert( "No se pudo hipotecar la propiedad." );
        }
    });

    btnUnmortgageProperty?.addEventListener('click', async () => {
        if (!currentLandingSquare || !localPlayer) return;

        const propertyId = currentLandingSquare.id;
        const propertyInfo = gameManager.propertiesState?.[propertyId];

        // Verificar que la propiedad exista
        if (!propertyInfo) {
            alert("No se encontró la información de la propiedad.");
            return;
        }

        // Verificar que el jugador sea el propietario
        if (propertyInfo.ownerId !== localPlayer.id) {
            alert("No eres dueño de esta propiedad.");
            return;
        }

        // Verificar que esté hipotecada
        if (!propertyInfo.mortgaged) {
            alert("Esta propiedad no está hipotecada.");
            return;
        }

        // Valor de la hipoteca
        const mortgageValue = Math.floor( currentLandingSquare.price / 2 );
        // Costo para recuperar la propiedad: 110%
        const unmortgageCost = Math.floor( mortgageValue * 1.10 );

        // Verificar dinero disponible
        if (localPlayer.money < unmortgageCost) {
            alert( `${localPlayer.name} no tiene suficiente dinero ` + `para deshipotecar esta propiedad.` );
            return;
        }

        const unmortgageMessage = `🏦 ${localPlayer.name} deshipotecó ` + `${currentLandingSquare.name} y pagó ` + `$${unmortgageCost}.`;

        try {
            await unmortgagePropertyInCloud(
                currentRoomId,
                propertyId,
                localPlayer.id,
                unmortgageCost,
                unmortgageMessage
            );

            buyModal.classList.add('hidden');

        } catch (error) {
            console.error( "Error al deshipotecar la propiedad:", error );
            alert( "No se pudo deshipotecar la propiedad." );
        }
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

    btnJailPay?.addEventListener( 'click', async () => {
        if (!localPlayer || !localPlayer.isJailed) return;

        try {

            await payJailFineInCloud(
                currentRoomId,
                localPlayer.id,
                `${localPlayer.name} pagó $50 para salir de la cárcel.`
            );

            localPlayer.isJailed = false;
            localPlayer.jailTurns = 0;

            jailPanel.classList.add('hidden');

            // Ahora puede lanzar los dados.
            await setTurnStatus(
                currentRoomId,
                "waiting-roll"
            );

        } catch (error) {

            console.error(
                "Error al pagar la cárcel:",
                error
            );

            alert(
                "No se pudo pagar la multa de la cárcel."
            );
        }
    });

    btnJailCard?.addEventListener( 'click', async () => {
        if (!localPlayer || !localPlayer.isJailed) return;

        if ( (localPlayer.getOutOfJailFreeCards || 0) <= 0 ) {
            alert( "No tienes una carta para salir de la cárcel." );
            return;
        }

        try {

            await useJailCardInCloud(
                currentRoomId,
                localPlayer.id,
                `${localPlayer.name} utilizó una carta para salir de la cárcel.`
            );

            localPlayer.isJailed = false;
            localPlayer.jailTurns = 0;
            localPlayer.getOutOfJailFreeCards--;

            jailPanel.classList.add('hidden');

            await setTurnStatus(
                currentRoomId,
                "waiting-roll"
            );

        } catch (error) {

            console.error(
                "Error al usar la carta:",
                error
            );

            alert(
                "No se pudo utilizar la carta."
            );
        }
    });

    btnAcceptCard?.addEventListener('click', async () => {
        if (!currentCard || !localPlayer || !currentRoomId) {
            cardModal.classList.add('hidden');
            return;
        }

        try {
            const card = currentCard;
            let message = null;
            let cardDice = [0, 0];

            // Cartas que afectan únicamente al jugador actual
            const basicCardTypes = [
                "receive_money",
                "pay_money",
                "move_back",
                "move_to",
                "go_to_jail",
                "get_out_of_jail_free"
            ];

            if (basicCardTypes.includes(card.type)) {

                message = applyBasicCardEffect( card, localPlayer, gameManager.propertiesState );

                await syncPlayerToRoom(
                    currentRoomId,
                    localPlayer
                );
            } else if ( card.type === "pay_each_player" || card.type === "receive_from_each_player" ) {

                const result = applyPlayerInteractionCardEffect( card, localPlayer, activePlayersList );
                message = result;

                // Sincronizamos a todos los jugadores
                for (const player of Object.values(activePlayersList)) {
                    await syncPlayerToRoom(
                        currentRoomId,
                        player
                    );
                }
            } else if (card.type === "nearest_railroad") {

                const result = applySpecialCardEffect( card, localPlayer, activePlayersList );
                message = result.message;
            
                // Sincronizamos la posición y el dinero del jugador.
                await syncPlayerToRoom(
                    currentRoomId,
                    localPlayer
                );
            
                // Si hubo propietario, también sincronizamos su dinero.
                if (result.owner) {
                    await syncPlayerToRoom(
                        currentRoomId,
                        result.owner
                    );
                }
            } else if (card.type === "nearest_utility") {

                const result = applySpecialCardEffect( card, localPlayer, activePlayersList );
                if (result.dice) cardDice = result.dice;
                message = result.message;
            
                await syncPlayerToRoom(
                    currentRoomId,
                    localPlayer
                );
            
                if (result.owner) {
                    await syncPlayerToRoom(
                        currentRoomId,
                        result.owner
                    );
                }
            }

            currentCard = null;
            cardModal.classList.add('hidden');

            if (message) {
                await updateDiceResult(
                    currentRoomId,
                    cardDice,
                    message
                );
            }

            drawPlayerToken(localPlayer);

        } catch (error) {

            console.error(
                "Error al aplicar carta:",
                error
            );

            alert(error.message);

            cardModal.classList.add('hidden');
            currentCard = null;
        }
    });
});
