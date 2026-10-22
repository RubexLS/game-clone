import { db } from '../config/firebase.js';
import { ref, set, update, onValue, off, get, runTransaction } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { BOARD_SQUARES } from '../core/board.js';
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS } from '../core/cards.js';

function getCardPaymentDetails(roomData, playerId, deckType, cardId) {
    if (!roomData || roomData.meta?.status !== "playing" || roomData.gameplay?.turnStatus !== "awaiting-end") {
        return null;
    }

    const players = roomData.players || {};
    const player = players[playerId];
    const playerIds = Object.keys(players);
    const turnIndex = roomData.gameplay.currentTurnIndex ?? 0;

    if (
        !player ||
        !Number.isFinite(player.money) ||
        !Number.isInteger(turnIndex) ||
        turnIndex < 0 ||
        turnIndex >= playerIds.length ||
        playerIds[turnIndex] !== playerId
    ) return null;

    const decks = {chance: CHANCE_CARDS, community: COMMUNITY_CHEST_CARDS};
    const deck = decks[deckType];

    if (!deck || !Number.isInteger(Number(cardId))) return null;

    const card = deck.find(item => item.id === Number(cardId));

    if (!card || !["pay_money", "property_tax"].includes(card.type)) return null;

    let cost = 0;

    if (card.type === "pay_money") {
        if (!Number.isFinite(card.amount) || card.amount < 0) {
            return null;
        }

        cost = card.amount;
    }

    if (card.type === "property_tax") {
        if (!Number.isFinite(card.houseCost) || card.houseCost < 0 || !Number.isFinite(card.hotelCost) || card.hotelCost < 0) {
            return null;
        }

        const properties = roomData.properties || {};

        for (const [propertyId, property] of Object.entries(properties)) {
            if (property?.ownerId !== playerId) continue;

            const square = BOARD_SQUARES.find(item => item.id === Number(propertyId));

            // Solo las propiedades edificables generan reparaciones.
            if (!square || square.type !== "property") continue;

            const houses = property.houses ?? 0;
            const hotel = property.hotel === true;

            if (
                !Number.isInteger(houses) ||
                houses < 0 ||
                houses > 4 ||
                (hotel && houses !== 0)
            ) return null;

            cost += hotel? card.hotelCost : houses * card.houseCost;
        }
    }

    if (!Number.isFinite(cost) || cost < 0) return null;
    return { player, card, cost };
}

export function payCardCostInCloud(roomId, playerId, deckType, cardId ) {
    const roomRef = ref(db, `rooms/${roomId}`);

    return runTransaction(roomRef, roomData => {
        const details = getCardPaymentDetails(roomData, playerId, deckType, cardId);

        if (!details || details.player.money < details.cost) return;

        const { player, card, cost } = details;

        roomData.players[playerId] = {
            ...player,
            money: player.money - cost
        };

        roomData.gameplay.lastAction = `${player.name} pagó $${cost} al banco. ${card.text}`;
        return roomData;
    }).then(result => {
        const snapshot = result.snapshot.val();

        if (result.committed) {
            // La deducción ya se realizó. No recalcular el coste a partir del saldo actualizado.
            return {
                success: true,
                bankrupt: false,
                snapshot,
                message: snapshot?.gameplay?.lastAction
            };
        }

        // Solo declarar insuficiencia si la carta, el turno y la sala siguen siendo válidos en el estado devuelto por Firebase.
        const details = getCardPaymentDetails(
            snapshot,
            playerId,
            deckType,
            cardId
        );

        if ( details && details.player.money < details.cost ) {
            return {
                success: false,
                bankrupt: true,
                cost: details.cost,
                message:
                    `${details.player.name} no tiene dinero suficiente ` +
                    `para pagar $${details.cost}.`
            };
        }

        throw new Error( "No se pudo procesar el pago. Verifica el turno, la carta y el estado de la sala." );
    });
}

// Crea una nueva sala de juego en Firebase con un ID único
// runTransaction evita sobrescribir una sala si dos usuarios intentan
// crear el mismo código casi al mismo tiempo.
export async function createGameRoom(roomId, hostId) {
    const roomRef = ref(db, `rooms/${roomId}`);
    
    // Estado inicial de una partida en la nube
    const initialGameState = {
        meta: {
            id: roomId,
            hostId,
            createdAt: Date.now(),
            status: "waiting" // waiting, playing, finished
        },
        gameplay: {
            currentTurnIndex: 0,
            turnStatus: "waiting-roll",
            dice: [0, 0],
            lastAction: "Sala creada"
        },
        players: {},      // Se llenará dinámicamente al unirse los jugadores
        properties: {}    // Estructura: { squareId: { ownerId, houses } }
    };

    try {
        const result = await runTransaction(roomRef, (currentRoom) => {
            // Devolver undefined cancela la transacción y conserva la sala existente.
            if (currentRoom !== null) return;
            return initialGameState;
        }, { applyLocally: false });

        if (!result.committed) {
            const error = new Error(`El código de sala "${roomId}" ya existe. Elige otro código.`);
            error.code = "ROOM_ALREADY_EXISTS";
            throw error;
        }

        console.log(`Sala ${roomId} creada con éxito en la nube.`);
        return result.snapshot.val();
    } catch (error) {
        console.error("Error al crear la sala:", error);
        throw error;
    }
}

/**
 * Une o actualiza un jugador dentro de una sala específica
 * @param {string} roomId 
 * @param {Object} playerInstance - Instancia de la clase Player
 * @returns {Promise<void>}
 */
export function syncPlayerToRoom(roomId, playerInstance) {
    const playerRef = ref(db, `rooms/${roomId}/players/${playerInstance.id}`);
    
    const playerData = {
        id: playerInstance.id,
        name: playerInstance.name,
        color: playerInstance.color,
        money: playerInstance.money,
        position: playerInstance.position,
        isJailed: playerInstance.isJailed,
        jailTurns: playerInstance.jailTurns || 0,
        getOutOfJailFreeCards: playerInstance.getOutOfJailFreeCards || 0,
    };

    return set(playerRef, playerData);
}

//Escucha los cambios de la sala en tiempo real y ejecuta un callback con los datos actualizados
export function listenToRoom(roomId, callback) {
    const roomRef = ref(db, `rooms/${roomId}`);

    const listener = onValue(roomRef, (snapshot) => {
        if (snapshot.exists()) {
            callback(snapshot.val());
        } else {
            console.warn(`La sala ${roomId} no existe en Firebase.` );
            callback(null);
        }
    });

    return () => {
        off(roomRef, 'value', listener);
        console.log( `Listener de la sala ${roomId} detenido.` );
    };
}

//Actualiza el resultado de los dados y las posiciones globales en la base de datos
export function updateDiceResult(roomId, diceValues, statusText) {
    const roomRef = ref(db, `rooms/${roomId}`);

    return runTransaction(roomRef, roomData => {
        if (!roomData) return;
        // No modificar una partida que ya terminó.
        if (roomData.meta?.status !== "playing") return;
        // No modificar una partida sin jugadores.
        if (!roomData.players || Object.keys(roomData.players).length === 0) return;

        roomData.gameplay = {
            ...roomData.gameplay,
            dice: diceValues,
            lastAction: statusText,
            turnStatus: "awaiting-end"
        };

        return roomData;
    }).then(result => {
        if (!result.committed) {
            throw new Error("No se pudo actualizar el resultado de los dados: la partida terminó o la sala no es válida.");
        }

        return result.snapshot.val();
    });
}

//Guarda la compra de una propiedad en la base de datos de Firebase
export function buyPropertyInCloud(roomId, squareId, playerId, propertyPrice, logMessage) {
    const roomRef = ref(db, `rooms/${roomId}`);

    // Validar el identificador de la casilla.
    const numericSquareId = Number(squareId);

    if ( !Number.isInteger(numericSquareId) || numericSquareId < 0 || numericSquareId >= BOARD_SQUARES.length ) {
        return Promise.reject( new Error("La casilla seleccionada no es válida.") );
    }

    // El precio real se obtiene del tablero, no del navegador.
    const boardSquare = BOARD_SQUARES.find( square => square.id === numericSquareId );

    if ( !boardSquare || !["property", "railroad", "utility"].includes(boardSquare.type) || !Number.isFinite(boardSquare.price) || boardSquare.price < 0 ) {
        return Promise.reject( new Error("Esta casilla no se puede comprar.") );
    }

    const authoritativePrice = boardSquare.price;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        // No comprar en salas que esperan jugadores o ya finalizaron.
        if (roomData.meta?.status !== "playing") return;

        const gameplay = roomData.gameplay || {};

        // La compra solo se permite después de la tirada del turno.
        if (gameplay.turnStatus !== "awaiting-end") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];

        if (!player) return;

        // Comprobar que sea el jugador del turno activo.
        const playerIds = Object.keys(players);
        const currentTurnIndex = gameplay.currentTurnIndex ?? 0;

        if ( !Number.isInteger(currentTurnIndex) || currentTurnIndex < 0 || currentTurnIndex >= playerIds.length ) {
            return;
        }

        const activePlayerId = playerIds[currentTurnIndex];

        if (activePlayerId !== playerId) return;
        // La propiedad debe seguir libre.
        if (properties[numericSquareId]) return;
        // El saldo debe ser válido y suficiente.
        if ( !Number.isFinite(player.money) || player.money < authoritativePrice ) return;

        // Aplicar la compra dentro de la transacción.
        player.money -= authoritativePrice;

        properties[numericSquareId] = {
            ownerId: playerId,
            houses: 0,
            hotel: false
        };

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay.lastAction = typeof logMessage === "string" ? logMessage : `${player.name} compró ${boardSquare.name}.`;
        return roomData;
    }).then((result) => {
        if (!result.committed) {
            throw new Error( "Compra rechazada: revisa el turno, el saldo y la disponibilidad." );
        }

        console.log("Propiedad comprada correctamente en Firebase.");
        return result.snapshot.val();
    });
}

export function mortgagePropertyInCloud( roomId, propertyId, playerId, mortgageValue, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    const numericPropertyId = Number(propertyId);
    const boardProperty = BOARD_SQUARES.find(square => square.id === numericPropertyId);

    if (!boardProperty || !["property", "railroad", "utility"].includes(boardProperty.type) || !Number.isFinite(boardProperty.price) || boardProperty.price < 0) {
        return Promise.reject(new Error("La casilla no admite hipotecas."));
    }

    // El importe enviado por el cliente no es confiable.
    const authoritativeValue = Math.floor(boardProperty.price / 2);

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;
        if (roomData.meta?.status !== "playing") return;

        const gameplay = roomData.gameplay || {};

        if (gameplay.turnStatus !== "awaiting-end") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];

        if (!player) return;

        // Validar que sea el turno del jugador.
        const playerIds = Object.keys(players);
        const turnIndex = gameplay.currentTurnIndex ?? 0;

        if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= playerIds.length || playerIds[turnIndex] !== playerId) {
            return;
        }

        const property = properties[numericPropertyId];

        if (!property || property.ownerId !== playerId) return;
        if (property.mortgaged) return;

        // No se puede hipotecar si hay construcciones en alguna propiedad del grupo de color.
        if (boardProperty.type === "property") {
            const groupProperties = BOARD_SQUARES.filter(
                square =>
                    square.type === "property" &&
                    square.group === boardProperty.group
            );

            const hasBuildingsInGroup = groupProperties.some(
                square => { const building = properties[square.id] || {};

                    return (
                        (building.houses || 0) > 0 ||
                        building.hotel === true
                    );
                }
            );

            if (hasBuildingsInGroup) return;
        }

        // Validación adicional sobre la propiedad elegida.
        if ((property.houses || 0) > 0 || property.hotel === true) return;
        if (!Number.isFinite(player.money)) return;

        player.money += authoritativeValue;
        property.mortgaged = true;
        players[playerId] = player;
        properties[numericPropertyId] = property;

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay.lastAction =
            typeof logMessage === "string" && logMessage.trim()
                ? logMessage
                : `🏦 ${player.name} hipotecó ${boardProperty.name} y recibió $${authoritativeValue}.`;

        return roomData;
    }).then((result) => {
        if (!result.committed) {
            throw new Error(
                "Hipoteca rechazada: revisa el turno, la propiedad y las construcciones del grupo."
            );
        }

        console.log("Propiedad hipotecada correctamente en Firebase.");
        return result.snapshot.val();
    });
}

export function unmortgagePropertyInCloud( roomId, propertyId, playerId, unmortgageCost, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    const numericPropertyId = Number(propertyId);
    const boardProperty = BOARD_SQUARES.find(square => square.id === numericPropertyId);

    if (!boardProperty || !["property", "railroad", "utility"].includes(boardProperty.type) || !Number.isFinite(boardProperty.price) || boardProperty.price < 0) {
        return Promise.reject(new Error("La casilla no admite deshipotecas."));
    }

    const mortgageValue = Math.floor(boardProperty.price / 2);
    const authoritativeCost = Math.ceil(mortgageValue * 1.1);

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;
        if (roomData.meta?.status !== "playing") return;

        const gameplay = roomData.gameplay || {};

        if (gameplay.turnStatus !== "awaiting-end") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];

        if (!player) return;

        // Validar que sea el turno del jugador.
        const playerIds = Object.keys(players);
        const turnIndex = gameplay.currentTurnIndex ?? 0;

        if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= playerIds.length || playerIds[turnIndex] !== playerId) {
            return;
        }

        const property = properties[numericPropertyId];

        if (!property || property.ownerId !== playerId) return;
        if (property.mortgaged !== true) return;
        if (!Number.isFinite(player.money) || player.money < authoritativeCost) return;

        player.money -= authoritativeCost;
        property.mortgaged = false;
        players[playerId] = player;
        properties[numericPropertyId] = property;

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay.lastAction =
            typeof logMessage === "string" && logMessage.trim()
                ? logMessage
                : `🏦 ${player.name} deshipotecó ${boardProperty.name} por $${authoritativeCost}.`;

        return roomData;
    }).then((result) => {
        if (!result.committed) {
            throw new Error("Deshipoteca rechazada: revisa el turno, el saldo y el estado de la propiedad.");
        }

        console.log("Propiedad deshipotecada correctamente en Firebase.");
        return result.snapshot.val();
    });
}

export function buildHouseInCloud( roomId, propertyId, playerId, houseCost, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    const numericPropertyId = Number(propertyId);
    const boardProperty = BOARD_SQUARES.find( square => square.id === numericPropertyId );

    // La casilla debe ser una propiedad edificable.
    if (!boardProperty || boardProperty.type !== "property" || !Number.isFinite(boardProperty.houseCost) || boardProperty.houseCost < 0) {
        return Promise.reject( new Error("La propiedad no admite construcción.") );
    }

    // El coste real procede del tablero.
    const authoritativeCost = boardProperty.houseCost;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        // La partida debe estar en curso.
        if (roomData.meta?.status !== "playing") return;

        const gameplay = roomData.gameplay || {};

        // La tirada debe haberse realizado y el turno seguir activo.
        if (gameplay.turnStatus !== "awaiting-end") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];

        if (!player) return;

        // Comprobar que el jugador tiene el turno.
        const playerIds = Object.keys(players);
        const turnIndex = gameplay.currentTurnIndex ?? 0;

        if ( !Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= playerIds.length || playerIds[turnIndex] !== playerId ) {
            return;
        }

        const property = properties[numericPropertyId];

        if (!property || property.ownerId !== playerId) return;
        if (property.mortgaged) return;
        if (property.hotel) return;

        const houses = property.houses ?? 0;

        if ( !Number.isInteger(houses) || houses < 0 || houses >= 4 ) return;
        if ( !Number.isFinite(player.money) || player.money < authoritativeCost ) return;

        // Obtener todas las propiedades del mismo grupo.
        const groupProperties = BOARD_SQUARES.filter(
            square =>
                square.type === "property" &&
                square.group === boardProperty.group
        );

        if (groupProperties.length === 0) return;

        const groupBuildings = groupProperties.map(square => { return properties[square.id]; });

        // Debe poseer todo el grupo y ninguna propiedad del grupo puede estar hipotecada.
        if (
            groupBuildings.some(
                building =>
                    !building ||
                    building.ownerId !== playerId ||
                    building.mortgaged ||
                    building.hotel
            )
        ) {
            return;
        }

        // No se puede construir si esta propiedad ya tiene más casas que alguna de las otras del grupo.
        const minimumHouses = Math.min(
            ...groupBuildings.map(
                building => building.houses ?? 0
            )
        );

        if (houses > minimumHouses) return;

        // Aplicar el coste y la construcción dentro de la misma transacción.
        player.money -= authoritativeCost;
        property.houses = houses + 1;
        players[playerId] = player;
        properties[numericPropertyId] = property;

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay.lastAction = typeof logMessage === "string" ? logMessage : `${player.name} construyó una casa en ${boardProperty.name}.`;
        return roomData;
    }).then((result) => {
        if (!result.committed) {
            throw new Error(
                "Construcción rechazada: revisa el turno, " +
                "el saldo, la propiedad y las reglas del grupo."
            );
        }

        console.log("Casa construida correctamente en Firebase.");
        return result.snapshot.val();
    });
}

export function sellHouseInCloud( roomId, propertyId, playerId, sellValue, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let sellApplied = false;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];
        const property = properties[propertyId];

        if (!player) return;
        if (!property) return;
        if (property.ownerId !== playerId) return;
        if (property.mortgaged) return;
        if (property.hotel) return;

        const houses = property.houses || 0;

        if (houses <= 0) return;
        if (player.money === undefined) return;

        // Verificar construcción equilibrada del grupo
        const boardProperty = BOARD_SQUARES.find(
            square => square.id === Number(propertyId)
        );

        if (!boardProperty) return;

        if (boardProperty.type !== 'property') return;

        const groupProperties = BOARD_SQUARES.filter(
            square =>
                square.type === 'property' &&
                square.group === boardProperty.group
        );

        const maximumOtherHouses = groupProperties
            .filter(groupProperty =>
                groupProperty.id !== Number(propertyId)
            )
            .reduce((maximum, groupProperty) => {
                const groupBuilding = properties[groupProperty.id] || {};
            
                return Math.max(
                    maximum,
                    groupBuilding.houses || 0
                );
            }, 0);
        
        if (houses < maximumOtherHouses) return;

        player.money += sellValue;
        property.houses = houses - 1;
        players[playerId] = player;
        properties[propertyId] = property;

        roomData.players = players;
        roomData.properties = properties;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        sellApplied = true;
        return roomData;
    }).then((result) => {
        if (!sellApplied || !result.committed) {
            throw new Error(
                "No se pudo vender la casa."
            );
        }
        console.log( "Casa vendida correctamente en Firebase." );
        return result.snapshot.val();
    });
}

export function sellHotelInCloud( roomId, propertyId, playerId, sellValue, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    const numericPropertyId = Number(propertyId);
    const boardProperty = BOARD_SQUARES.find( square => square.id === numericPropertyId );

    if (!boardProperty || boardProperty.type !== "property" || !Number.isFinite(boardProperty.hotelCost) || boardProperty.hotelCost < 0) {
        return Promise.reject(new Error("La propiedad no admite la venta de hoteles."));
    }

    // El reembolso no depende del importe enviado por el cliente.
    const authoritativeSellValue = Math.floor(boardProperty.hotelCost / 2);

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;
        if (roomData.meta?.status !== "playing") return;

        const gameplay = roomData.gameplay || {};

        if (gameplay.turnStatus !== "awaiting-end") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];

        if (!player) return;

        // Comprobar que sea el turno del jugador.
        const playerIds = Object.keys(players);
        const turnIndex = gameplay.currentTurnIndex ?? 0;

        if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= playerIds.length || playerIds[turnIndex] !== playerId) {
            return;
        }

        const property = properties[numericPropertyId];

        if (!property || property.ownerId !== playerId) return;
        if (property.mortgaged) return;
        if (property.hotel !== true) return;

        if (!Number.isFinite(player.money) || !Number.isFinite(authoritativeSellValue)) return;

        // Obtener todas las propiedades del mismo grupo.
        const groupProperties = BOARD_SQUARES.filter(
            square =>
                square.type === "property" &&
                square.group === boardProperty.group
        );

        if (groupProperties.length === 0) return;

        // El jugador debe poseer todo el grupo y ninguna propiedad del grupo puede estar hipotecada.
        const groupBuildings = groupProperties.map(square => ({square, state: properties[square.id]}));

        if (
            groupBuildings.some(({ square, state }) =>
                !state || state.ownerId !== playerId || state.mortgaged
            )
        ) {
            return;
        }

        // Tras vender el hotel, esta propiedad vuelve a tener cuatro casas. Las demás deben tener cuatro casas y no tener hotel para mantener el grupo equilibrado.
        const otherProperties = groupBuildings.filter(({ square }) => square.id !== numericPropertyId);

        if (otherProperties.some(({ state }) => state.hotel === true || (state.houses || 0) !== 4)) {
            return;
        }

        // Aplicar el reembolso y la conversión en la misma transacción de Firebase.
        player.money += authoritativeSellValue;

        property.hotel = false;
        property.houses = 4;
        players[playerId] = player;
        properties[numericPropertyId] = property;

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay.lastAction =
            typeof logMessage === "string" && logMessage.trim()
                ? logMessage
                : `🏨 ${player.name} vendió el hotel de ` + `${boardProperty.name} y recibió ` + `$${authoritativeSellValue}.`;

        return roomData;
    }).then((result) => {
        if (!result.committed) {
            throw new Error(
                "Venta rechazada: revisa el turno, la propiedad, " +
                "el grupo y el estado de la partida."
            );
        }

        console.log("Hotel vendido correctamente en Firebase.");
        return result.snapshot.val();
    });
}

export function buildHotelInCloud( roomId, propertyId, playerId, hotelCost, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    const numericPropertyId = Number(propertyId);
    const boardProperty = BOARD_SQUARES.find( square => square.id === numericPropertyId );

    if (!boardProperty || boardProperty.type !== "property" || !Number.isFinite(boardProperty.hotelCost) || boardProperty.hotelCost < 0) {
        return Promise.reject( new Error("La propiedad no admite la construcción de hoteles.") );
    }

    const authoritativeCost = boardProperty.hotelCost;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;
        if (roomData.meta?.status !== "playing") return;

        const gameplay = roomData.gameplay || {};

        if (gameplay.turnStatus !== "awaiting-end") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];

        if (!player) return;

        // Validar que sea el turno del jugador.
        const playerIds = Object.keys(players);
        const turnIndex = gameplay.currentTurnIndex ?? 0;

        if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= playerIds.length || playerIds[turnIndex] !== playerId) {
            return;
        }

        // Validar propiedad y titularidad.
        const property = properties[numericPropertyId];

        if (!property || property.ownerId !== playerId) return;
        if (property.mortgaged) return;
        if (property.hotel) return;
        if (property.houses !== 4) return;

        // Identificar todas las propiedades del mismo grupo.
        const groupProperties = BOARD_SQUARES.filter( square =>
                square.type === "property" &&
                square.group === boardProperty.group
        );

        if (groupProperties.length === 0) return;

        const groupBuildings = groupProperties.map( square => properties[square.id] );

        // Debe poseer todo el grupo y no tener propiedades hipotecadas.
        if (groupBuildings.some( building =>
            !building || building.ownerId !== playerId || building.mortgaged
        )) return;

        // Para construir el hotel, las demás propiedades del grupo deben tener cuatro casas o un hotel.
        if (
            groupProperties.some((square, index) => {
                const building = groupBuildings[index];

                if (square.id === numericPropertyId) {
                    return building.hotel || building.houses !== 4;
                }

                return !building.hotel && building.houses !== 4;
            })) 
        {
            return;
        }

        // Validar saldo dentro de Firebase.
        if ( !Number.isFinite(player.money) || player.money < authoritativeCost) return;

        // Aplicar todos los cambios en la misma transacción.
        player.money -= authoritativeCost;
        property.houses = 0;
        property.hotel = true;
        players[playerId] = player;
        properties[numericPropertyId] = property;

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay.lastAction = typeof logMessage === "string" && logMessage.trim() ? logMessage : `🏨 ${player.name} construyó un hotel en ${boardProperty.name}.`;
        return roomData;
    }).then((result) => {
        if (!result.committed) {
            throw new Error(
                "Construcción rechazada: revisa el turno, " + "el saldo y las condiciones del grupo."
            );
        }

        console.log("Hotel construido correctamente en Firebase.");
        return result.snapshot.val();
    });
}

function calculateAuthoritativeRent(roomData, propertyId, payerId, ownerId) {
    if (!roomData || roomData.meta?.status !== "playing" || roomData.gameplay?.turnStatus !== "awaiting-end" ) return null;

    const players = roomData.players || {};
    const properties = roomData.properties || {};
    const payer = players[payerId];
    const owner = players[ownerId];
    const property = properties[propertyId];

    if (
        !payer ||
        !owner ||
        payerId === ownerId ||
        !property ||
        property.ownerId !== ownerId ||
        !Number.isFinite(payer.money) ||
        !Number.isFinite(owner.money)
    ) return null;

    const playerIds = Object.keys(players);
    const turnIndex = roomData.gameplay.currentTurnIndex;

    if (
        !Number.isInteger(turnIndex) ||
        turnIndex < 0 ||
        turnIndex >= playerIds.length ||
        playerIds[turnIndex] !== payerId
    ) return null;

    const square = BOARD_SQUARES.find(item => item.id === Number(propertyId));

    if (!square || !["property", "railroad", "utility"].includes(square.type)) return null;

    const dice = roomData.gameplay.dice;

    if (
        !Array.isArray(dice) ||
        dice.length !== 2 ||
        !dice.every(value => Number.isInteger(value) && value >= 1 && value <= 6)
    ) return null;

    // Las propiedades hipotecadas no cobran alquiler.
    if (property.mortgaged === true) return 0;

    if (square.type === "property") {
        const houses = property.houses ?? 0;
        const hotel = property.hotel === true;
        const rents = square.rent;

        if (
            !Array.isArray(rents) ||
            rents.length < 6 ||
            !rents.every(value => Number.isFinite(value) && value >= 0) ||
            !Number.isInteger(houses) ||
            houses < 0 ||
            houses > 4 ||
            (hotel && houses !== 0)
        ) return null;

        if (hotel) return rents[5];
        if (houses > 0) return rents[houses];

        const group = BOARD_SQUARES.filter(item => item.type === "property" && item.group === square.group);
        const ownsEntireGroup = group.length > 0 && group.every(item => properties[item.id]?.ownerId === ownerId);

        return rents[0] * (ownsEntireGroup ? 2 : 1);
    }

    if (square.type === "railroad") {
        const count = BOARD_SQUARES.filter(
            item =>
                item.type === "railroad" &&
                properties[item.id]?.ownerId === ownerId
        ).length;

        const rents = [0, 25, 50, 100, 200];

        return count >= 1 && count <= 4 ? rents[count] : null;
    }

    if (square.type === "utility") {
        const count = BOARD_SQUARES.filter(
            item =>
                item.type === "utility" &&
                properties[item.id]?.ownerId === ownerId
        ).length;

        if (count < 1 || count > 2) return null;

        return (dice[0] + dice[1]) * (count === 1 ? 4 : 10);
    }

    return null;
}

export function payRentInCloud( roomId, propertyId, payerId, ownerId, logMessage ) {
    
    const roomRef = ref(db, `rooms/${roomId}`);
    const numericPropertyId = Number(propertyId);
    const boardProperty = BOARD_SQUARES.find(square => square.id === numericPropertyId);

    if (!boardProperty || !["property", "railroad", "utility"].includes(boardProperty.type)) {
        return Promise.reject(new Error("La casilla no admite el cobro de alquiler."));
    }

    return runTransaction(roomRef, (roomData) => {
        insufficientFunds = false;

        if (!roomData) return;
        if (roomData.meta?.status !== "playing") return;

        const gameplay = roomData.gameplay || {};

        if (gameplay.turnStatus !== "awaiting-end") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const payer = players[payerId];
        const owner = players[ownerId];
        const property = properties[numericPropertyId];

        if (!payer || !owner || !property) return;
        if (payerId === ownerId) return;
        if (property.ownerId !== ownerId) return;

        // Verificar que sea el turno del jugador que paga.
        const playerIds = Object.keys(players);
        const turnIndex = gameplay.currentTurnIndex ?? 0;

        if (!Number.isInteger(turnIndex) || turnIndex < 0 || turnIndex >= playerIds.length || playerIds[turnIndex] !== payerId) {
            return;
        }

        // Los dados se obtienen del estado de Firebase.
        const dice = gameplay.dice;

        if (!Array.isArray(dice) || dice.length !== 2 || !dice.every(
                value =>
                    Number.isInteger(value) &&
                    value >= 1 &&
                    value <= 6
            )
        ) return;

        const diceTotal = dice[0] + dice[1];

        // Una propiedad hipotecada no cobra alquiler.
        let authoritativeRent = 0;

        if (!property.mortgaged) {
            if (boardProperty.type === "property") {
                const houses = property.houses || 0;
                const hasHotel = property.hotel === true;
                const rentTable = boardProperty.rent;

                if (
                    !Array.isArray(rentTable) ||
                    rentTable.length < 6 ||
                    !Number.isInteger(houses) ||
                    houses < 0 ||
                    houses > 4 ||
                    (hasHotel && houses !== 0)
                ) return;

                // Hotel: índice 5.
                if (hasHotel) {
                    authoritativeRent = rentTable[5];
                } else if (houses > 0) {
                    // Una a cuatro casas: índices 1 a 4.
                    authoritativeRent = rentTable[houses];
                } else {
                    // Sin construcciones: doble alquiler si el propietario posee todo el grupo.
                    const groupProperties = BOARD_SQUARES.filter(
                        square =>
                            square.type === "property" &&
                            square.group === boardProperty.group
                    );

                    const ownsEntireGroup =
                        groupProperties.length > 0 &&
                        groupProperties.every(square => {
                            const groupProperty =
                                properties[square.id];

                            return (
                                groupProperty?.ownerId === ownerId
                            );
                        });

                    authoritativeRent = rentTable[0] * (ownsEntireGroup ? 2 : 1);
                }
            } else if (boardProperty.type === "railroad") {
                const railroadCount = BOARD_SQUARES.filter(
                    square => {
                        if (square.type !== "railroad") return false;
                        return (properties[square.id]?.ownerId === ownerId);
                    }
                ).length;

                const railroadRents = [0, 25, 50, 100, 200];
                if (railroadCount < 1 || railroadCount > 4) return;
                authoritativeRent = railroadRents[railroadCount];
            } else if (boardProperty.type === "utility") {
                const utilityCount = BOARD_SQUARES.filter(
                    square =>
                        square.type === "utility" &&
                        properties[square.id]?.ownerId === ownerId
                ).length;

                if (utilityCount < 1 || utilityCount > 2) return;
                authoritativeRent =diceTotal * (utilityCount === 1 ? 4 : 10);
            }
        }

        if (!Number.isFinite(authoritativeRent) || authoritativeRent < 0 || !Number.isFinite(payer.money) || !Number.isFinite(owner.money)) {
            return;
        }

        calculatedRent = authoritativeRent;

        // Si no tiene dinero suficiente, cancelar sin transferir.
        if (payer.money < authoritativeRent) {
            insufficientFunds = true;
            return;
        }

        payer.money -= authoritativeRent;
        owner.money += authoritativeRent;

        players[payerId] = payer;
        players[ownerId] = owner;
        roomData.players = players;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction =
            typeof logMessage === "string" && logMessage.trim()
                ? logMessage
                : `${payer.name} pagó $${authoritativeRent} de alquiler a ${owner.name} por ${boardProperty.name}.`;
        return roomData;
    }).then((result) => {
        const snapshot = result.snapshot.val();
        const rentAmount = calculateAuthoritativeRent(snapshot, numericPropertyId, payerId, ownerId);

        if (result.committed) {
            return {
                success: true,
                bankrupt: false,
                snapshot
            };
        }

        const payer = snapshot?.players?.[payerId];
        const owner = snapshot?.players?.[ownerId];
        const property = snapshot?.properties?.[numericPropertyId];

        // Solo reconocer bancarrota si la sala y los jugadores siguen existiendo y la propiedad sigue perteneciendo al arrendador
        if (
            rentAmount !== null &&
            rentAmount !== undefined &&
            snapshot?.players?.[payerId]?.money < rentAmount
        ) {
            const payer = snapshot.players[payerId];

            return {
                success: false,
                bankrupt: true,
                rentAmount,
                snapshot,
                message: `${payer.name} no tiene dinero suficiente para pagar $${rentAmount} de alquiler.`
            };
        }

        throw new Error( "No se pudo completar el pago del alquiler. Verifica el turno, la propiedad y el estado de la sala." );
    });
}

//Pasa el turno al siguiente jugador en la base de datos de Firebase
export function endTurnInCloud(roomId, playerId) {
    const roomRef = ref(db, `rooms/${roomId}`);

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;
        // No avanzar una partida finalizada.
        if (roomData.meta?.status === "finished") return;

        const players = roomData.players || {};
        const playerUidsOrder = Object.keys(players);
        const gameplay = roomData.gameplay || {};

        // Debe quedar al menos un jugador.
        if (playerUidsOrder.length === 0) return;
        // Solo se puede terminar un turno que espera su cierre.
        if (gameplay.turnStatus !== "awaiting-end") return;
        // Verificar que el jugador solicitante siga en la sala.
        if (!players[playerId]) return;

        // Comprobar que realmente sea su turno.
        const currentIndex = gameplay.currentTurnIndex;
        const activeTurnUid = playerUidsOrder[currentIndex];

        if (activeTurnUid !== playerId) return;

        // Calcular el siguiente jugador dentro de la transacción.
        const nextTurnIndex = (currentIndex + 1) % playerUidsOrder.length;
        const nextPlayerId = playerUidsOrder[nextTurnIndex];
        const nextPlayerName = players[nextPlayerId]?.name || "Siguiente jugador";

        gameplay.currentTurnIndex = nextTurnIndex;
        gameplay.turnStatus = "waiting-roll";
        gameplay.lastAction = `--- ${players[playerId].name} terminó su turno. Ahora es el turno de ${nextPlayerName}. ---`;

        roomData.gameplay = gameplay;
        return roomData;
    }).then((result) => {
        if (!result.committed) {
            throw new Error(
                "No se pudo finalizar el turno. Verifica que siga siendo tu turno y que la partida continúe."
            );
        }

        console.log("Turno finalizado correctamente en Firebase.");
        return result.snapshot.val();
    });
}

//Obtiene una captura única y fresca de los datos de la sala actual
export function getRoomSnapshot(roomId) {
    const roomRef = ref(db, `rooms/${roomId}`);
    return get(roomRef)
        .then((snapshot) => snapshot.exists() ? snapshot.val() : null)
        .catch((error) => {
            console.error("Error al obtener snapshot de la sala:", error);
            throw error;
        });
}

export function payTaxInCloud( roomId, playerId, taxAmount, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);

    // Validar el importe antes de iniciar la transacción.
    if (!Number.isFinite(taxAmount) || taxAmount < 0) {
        return Promise.reject( new Error("El importe del impuesto no es válido.") );
    }

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;
        // No procesar pagos en una partida finalizada.
        if (roomData.meta?.status === "finished") return;

        const players = roomData.players || {};
        const player = players[playerId];

        if (!player) return;

        // Cancelar si el jugador no tiene dinero suficiente.
        if (!Number.isFinite(player.money) || player.money < taxAmount) return;

        // Aplicar el pago dentro de la transacción.
        player.money -= taxAmount;
        players[playerId] = player;
        roomData.players = players;

        if (!roomData.gameplay) roomData.gameplay = {};
        roomData.gameplay.lastAction = logMessage;

        return roomData;
    }).then((result) => {
        const snapshot = result.snapshot.val();
        const player = snapshot?.players?.[playerId];

        // Pago confirmado.
        if (result.committed) {
            return {
                success: true,
                bankrupt: false,
                snapshot
            };
        }

        // Distinguir fondos insuficientes de otros rechazos.
        if (
            player &&
            Number.isFinite(player.money) &&
            player.money < taxAmount
        ) {
            return {
                success: false,
                bankrupt: true
            };
        }

        throw new Error(
            "No se pudo realizar el pago del impuesto. " +
            "Verifica el estado de la sala y del jugador."
        );
    });
}

export function handleBankruptcyInCloud( roomId, debtorId, creditorId, logMessage, expectedDebt ) {
    const roomRef = ref(db, `rooms/${roomId}`);

    return runTransaction(roomRef, (roomData) => {
        // La sala debe existir.
        if (!roomData) return;

        // No se permiten bancarrotas en una partida finalizada.
        if (roomData.meta?.status === "finished") return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const debtor = players[debtorId];

        // El deudor todavía debe existir.
        if (!debtor) return;

        // Validar que exista una deuda comprobable.
        if (!Number.isFinite(expectedDebt) || expectedDebt < 0 || !Number.isFinite(debtor.money) || debtor.money >= expectedDebt) {
            return;
        }

        // Guardar el orden y el turno antes de eliminar al jugador.
        const gameplay = roomData.gameplay || {};
        const playerOrderBefore = Object.keys(players);
        const debtorIndex = playerOrderBefore.indexOf(debtorId);
        const currentTurnIndex = Number.isInteger(gameplay.currentTurnIndex) ? gameplay.currentTurnIndex : 0;
        const debtorWasActive = debtorIndex === currentTurnIndex;

        if (roomData.meta?.status !== "playing" || gameplay.turnStatus !== "awaiting-end" || !debtorWasActive) return;

        // Si existe un acreedor, debe ser válido y distinto del deudor.
        if (creditorId) {
            const creditor = players[creditorId];

            if (!creditor) return;
            if (debtorId === creditorId) return;
        }

        // Transferir o liberar las propiedades del jugador quebrado.
        for (const propertyId of Object.keys(properties)) {
            const property = properties[propertyId];

            if (property.ownerId !== debtorId) continue;

            if (creditorId) {
                // La propiedad pasa al acreedor.
                property.ownerId = creditorId;

                // Las construcciones se eliminan.
                property.houses = 0;
                property.hotel = false;
                // Se conserva el estado de hipoteca.
                properties[propertyId] = property;
            } else {
                // Si la deuda es con el banco, la propiedad queda libre.
                delete properties[propertyId];
            }
        }

        // Eliminar al jugador quebrado.
        delete players[debtorId];

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay = gameplay;

        // Ajustar el índice para conservar el turno correcto.
        const remainingPlayerIds = Object.keys(players);

        if (remainingPlayerIds.length > 0) {
            let adjustedIndex = currentTurnIndex;

            // Si el eliminado estaba antes del jugador activo, el índice del jugador activo disminuye en uno.
            if ( debtorIndex !== -1 && debtorIndex < currentTurnIndex ) adjustedIndex--;

            // Mantener el índice dentro de la lista actual.
            gameplay.currentTurnIndex = ((adjustedIndex % remainingPlayerIds.length) + remainingPlayerIds.length) % remainingPlayerIds.length;

            // Si el eliminado tenía el turno, el siguiente jugador podrá comenzar su turno normalmente.
            if ( debtorWasActive && remainingPlayerIds.length > 1 ) gameplay.turnStatus = "waiting-roll";
        }

        if (!roomData.gameplay) roomData.gameplay = {};
        if (!roomData.meta) roomData.meta = {};

        if (remainingPlayerIds.length === 0) {
            // No quedan jugadores: finalizar sin ganador.
            roomData.meta.status = "finished";
            delete roomData.meta.winnerId;
            delete roomData.meta.winnerName;
            roomData.gameplay.turnStatus = "finished";
            roomData.gameplay.lastAction = `${logMessage} La partida terminó sin ganador porque no quedan jugadores.`;

        } else if (remainingPlayerIds.length === 1) {
            // Queda un jugador: declararlo ganador.
            const winnerId = remainingPlayerIds[0];
            const winner = players[winnerId];

            roomData.meta.status = "finished";
            roomData.meta.winnerId = winnerId;
            roomData.meta.winnerName = winner.name;
            roomData.gameplay.turnStatus = "finished";
            roomData.gameplay.lastAction = `${logMessage} ${winner.name} es el ganador.`;
        } else {
            // Quedan dos o más jugadores: la partida continúa.
            roomData.gameplay.lastAction = logMessage;
        }
        return roomData;
    }).then((result) => {
        // Solo se acepta una transacción confirmada por Firebase.
        if (!result.committed) {
            throw new Error(
                "No se pudo completar la bancarrota: la sala, el jugador o el estado de la partida no son válidos."
            );
        }

        console.log("Bancarrota procesada correctamente en Firebase.");
        return result.snapshot.val();
    });
}

export function setTurnStatus(roomId, status) {
    const gameplayRef = ref(db, `rooms/${roomId}/gameplay`);

    return update(gameplayRef, {
        turnStatus: status
    });
}

export function sendPlayerToJailInCloud( roomId, playerId, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let actionApplied = false;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        const players = roomData.players || {};
        const player = players[playerId];

        if (!player) return;

        player.position = 10;
        player.isJailed = true;
        player.jailTurns = 0;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        actionApplied = true;
        return roomData;

    }).then((result) => {

        if (!actionApplied || !result.committed) {
            throw new Error(
                "No se pudo enviar al jugador a la cárcel."
            );
        }

        console.log( "Jugador enviado a la cárcel correctamente." );
        return result.snapshot.val();
    });
}

//salir pagando
export function payJailFineInCloud( roomId, playerId, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let actionApplied = false;

    return runTransaction(roomRef, (roomData) => {

        if (!roomData) return;
        const player = roomData.players?.[playerId];

        if (!player) return;
        if (!player.isJailed) return;
        if (player.money < 50) return;

        player.money -= 50;
        player.isJailed = false;
        player.jailTurns = 0;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        actionApplied = true;
        return roomData;

    }).then((result) => {

        if (!actionApplied || !result.committed) {
            throw new Error(
                "No se pudo pagar la multa de la cárcel."
            );
        }

        return result.snapshot.val();
    });
}

//salir usando carta
export function useJailCardInCloud( roomId, playerId, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let actionApplied = false;

    return runTransaction(roomRef, (roomData) => {

        if (!roomData) return;

        const player = roomData.players?.[playerId];

        if (!player) return;
        if (!player.isJailed) return;
        if ((player.getOutOfJailFreeCards || 0) <= 0) return;

        player.getOutOfJailFreeCards -= 1;
        player.isJailed = false;
        player.jailTurns = 0;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        actionApplied = true;
        return roomData;

    }).then((result) => {

        if (!actionApplied || !result.committed) {
            throw new Error(
                "No se pudo utilizar la carta de cárcel."
            );
        }

        return result.snapshot.val();
    });
}

export function registerJailAttemptInCloud( roomId, playerId, jailTurns, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let actionApplied = false;

    return runTransaction(roomRef, (roomData) => {

        if (!roomData) return;

        const player = roomData.players?.[playerId];

        if (!player) return;
        if (!player.isJailed) return;

        player.jailTurns = jailTurns;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        actionApplied = true;
        return roomData;

    }).then((result) => {

        if (!actionApplied || !result.committed) {
            throw new Error(
                "No se pudo registrar el intento de cárcel."
            );
        }

        return result.snapshot.val();
    });
}

function getInteractionCardDetails(roomData, playerId, deckType, cardId) {
    if (!roomData || roomData.meta?.status !== "playing" || roomData.gameplay?.turnStatus !== "awaiting-end") return null;

    const players = roomData.players || {};
    const player = players[playerId];
    const playerIds = Object.keys(players);
    const turnIndex = roomData.gameplay.currentTurnIndex ?? 0;

    if (
        !player ||
        !Number.isFinite(player.money) ||
        !Number.isInteger(turnIndex) ||
        turnIndex < 0 ||
        turnIndex >= playerIds.length ||
        playerIds[turnIndex] !== playerId
    ) return null;

    const decks = {chance: CHANCE_CARDS, community: COMMUNITY_CHEST_CARDS};
    const deck = decks[deckType];

    if (!deck || !Number.isInteger(Number(cardId))) return null;

    const card = deck.find(item => item.id === Number(cardId));

    if (
        !card ||
        !["pay_each_player", "receive_from_each_player"].includes(card.type) ||
        !Number.isFinite(card.amount) ||
        card.amount < 0
    ) return null;

    const otherPlayers = Object.entries(players).filter(([id]) => id !== playerId);
    const insolventDebtors = [];

    for (const [id, otherPlayer] of otherPlayers) {
        if (!Number.isFinite(otherPlayer.money)) return null;

        if (card.type === "receive_from_each_player" && otherPlayer.money < card.amount) {
            insolventDebtors.push({
                debtorId: id,
                cost: card.amount
            });
        }
    }

    const totalPayment = card.amount * otherPlayers.length;

    if (!Number.isFinite(totalPayment) || card.amount * otherPlayers.length < 0) return null;

    if (card.type === "pay_each_player" && player.money < totalPayment) {
        return {
            player,
            card,
            otherPlayers,
            insufficientFunds: true,
            debtorId: playerId,
            cost: totalPayment,
            insolventDebtors: []
        };
    }

    return {
        player,
        card,
        otherPlayers,
        insufficientFunds: false,
        insolventDebtors
    };
}

export function applyPlayerInteractionCardInCloud( roomId, playerId, deckType, cardId ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let eliminatedPlayers = [];

    return runTransaction(roomRef, roomData => {
        eliminatedPlayers = [];

        const details = getInteractionCardDetails(
            roomData,
            playerId,
            deckType,
            cardId
        );

        if (!details || details.insufficientFunds) return;

        const {player, card, otherPlayers, insolventDebtors} = details;
        const players = { ...roomData.players };
        const properties = { ...(roomData.properties || {}) };
        const gameplay = { ...(roomData.gameplay || {}) };
        const bankruptIds = insolventDebtors.map(item => item.debtorId);

        eliminatedPlayers = [...bankruptIds];

        if (card.type === "pay_each_player") {
            const totalPayment = card.amount * otherPlayers.length;

            players[playerId] = {
                ...player,
                money: player.money - totalPayment
            };

            for (const [id, otherPlayer] of otherPlayers) {
                players[id] = {
                    ...otherPlayer,
                    money: otherPlayer.money + card.amount
                };
            }
        } else {
            let totalReceived = 0;

            for (const [id, otherPlayer] of otherPlayers) {
                if (bankruptIds.includes(id)) continue;

                players[id] = {
                    ...otherPlayer,
                    money: otherPlayer.money - card.amount
                };

                totalReceived += card.amount;
            }

            players[playerId] = {
                ...player,
                money: player.money + totalReceived
            };

            // Transferir las propiedades de cada jugador insolvente al jugador que debía recibir el dinero.
            for (const debtorId of bankruptIds) {
                for (const [propertyId, property] of Object.entries(properties)) {
                    if (property?.ownerId !== debtorId) continue;

                    properties[propertyId] = {
                        ...property,
                        ownerId: playerId,
                        houses: 0,
                        hotel: false,
                        mortgaged: property.mortgaged === true
                    };
                }

                delete players[debtorId];
            }

            // Ajustar el turno si se eliminaron jugadores anteriores al jugador activo en el orden original.
            const originalOrder = Object.keys(roomData.players);
            const originalTurnIndex = gameplay.currentTurnIndex;
            const activeIndex = originalOrder.indexOf(playerId);

            if (activeIndex === -1) return;

            const removedBeforeActive = bankruptIds.filter(id => originalOrder.indexOf(id) < activeIndex).length;
            const remainingIds = Object.keys(players);

            if (remainingIds.length > 0) gameplay.currentTurnIndex = activeIndex - removedBeforeActive;

            // Comprobar si queda un único ganador.
            if (remainingIds.length === 1) {
                const winnerId = remainingIds[0];

                roomData.meta = {
                    ...roomData.meta,
                    status: "finished",
                    winnerId,
                    winnerName: players[winnerId].name
                };

                gameplay.turnStatus = "finished";
            }

            if (bankruptIds.length > 0) {
                const names = bankruptIds
                    .map(id => otherPlayers.find(([otherId]) => otherId === id)?.[1].name || id)
                    .join(", ");

                gameplay.lastAction = `${player.name} recibió $${card.amount} de cada jugador solvente. Bancarrota: ${names}. Sus propiedades fueron transferidas a ${player.name}.`;
            } else {
                gameplay.lastAction = `${player.name} recibió $${card.amount} de cada jugador.`;
            }
        }

        roomData.players = players;
        roomData.properties = properties;
        roomData.gameplay = gameplay;

        return roomData;
    }).then(result => {
        const snapshot = result.snapshot.val();

        if (result.committed) {
            return {
                success: true,
                bankrupt: false,
                snapshot,
                message: snapshot?.gameplay?.lastAction,
                eliminatedPlayers: [...eliminatedPlayers]
            };
        }

        const details = getInteractionCardDetails(snapshot, playerId, deckType, cardId);

        if (details?.insufficientFunds) {
            return {
                success: false,
                bankrupt: false,
                insufficientFunds: true,
                debtorId: details.debtorId,
                cost: details.cost,
                message: `${snapshot.players[details.debtorId].name} no tiene dinero suficiente para pagar $${details.cost}.`
            };
        }

        throw new Error("No se pudo procesar la carta. Verifica el turno y el estado de la sala.");
    });
}