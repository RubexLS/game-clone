import { db } from '../config/firebase.js';
import { ref, set, update, onValue, off, get, runTransaction } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { BOARD_SQUARES } from '../core/board.js';

// Crea una nueva sala de juego en Firebase con un ID único
export function createGameRoom(roomId, hostId) {
    const roomRef = ref(db, `rooms/${roomId}`);
    
    // Estado inicial de una partida en la nube
    const initialGameState = {
        meta: {
            id: roomId,
            hostId: hostId,
            createdAt: Date.now(),
            status: "waiting" // waiting, playing, finished
        },
        gameplay: {
            currentTurnIndex: 0,
            turnStatus: "waiting-roll",
            dice:[0, 0],
            lastAction: "Sala creada"
        },
        players: {},      // Se llenará dinámicamente al unirse los jugadores
        properties: {}    // Estructura: { squareId: { ownerId, houses } }
    };

    return set(roomRef, initialGameState)
        .then(() => console.log(`Sala ${roomId} creada con éxito en la nube.`))
        .catch((error) => {
            console.error("Error al crear la sala:", error);
            throw error;
        });
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
    const gameplayRef = ref(db, `rooms/${roomId}/gameplay`);
    return update(gameplayRef, {
        dice: diceValues,
        lastAction: statusText,
        turnStatus: "awaiting-end"
    });
}

//Guarda la compra de una propiedad en la base de datos de Firebase
export function buyPropertyInCloud(roomId, squareId, playerId, propertyPrice, logMessage) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let purchaseApplied = false;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];
        const property = properties[squareId];

        // El jugador debe existir
        if (!player) return;
        // La propiedad debe seguir libre
        if (property) return;
        // El jugador debe tener suficiente dinero
        if (player.money < propertyPrice) return;

        // Descontar el precio
        player.money -= propertyPrice;

        // Registrar propietario y edificios iniciales
        properties[squareId] = {
            ownerId: playerId,
            houses: 0,
            hotel: false
        };

        // Guardar cambios
        roomData.players = players;
        roomData.properties = properties;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        purchaseApplied = true;

        return roomData;
    }).then((result) => {
        if (!purchaseApplied || !result.committed) {
            throw new Error(
                "No se pudo completar la compra de la propiedad."
            );
        }

        console.log( "Propiedad comprada correctamente en Firebase." );
        return result.snapshot.val();
    });
}

export function mortgagePropertyInCloud( roomId, propertyId, playerId, mortgageValue, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let mortgageApplied = false;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];
        const property = properties[propertyId];

        if (!player) return;
        if (!property) return;
        // La propiedad debe pertenecer al jugador.
        if (property.ownerId !== playerId) return;
        // No se puede hipotecar dos veces.
        if (property.mortgaged) return;

        const boardProperty = BOARD_SQUARES.find( square => square.id === Number(propertyId) );

        if (!boardProperty) return;
        if (boardProperty.type === 'property') {
            const groupProperties = BOARD_SQUARES.filter(
                square =>
                    square.type === 'property' &&
                    square.group === boardProperty.group
            );
        
            const hasBuildingsInGroup = groupProperties.some(groupProperty => {
                const groupBuilding = properties[groupProperty.id] || {};
                const houses = groupBuilding.houses || 0;
                const hotel = groupBuilding.hotel || false;
                return houses > 0 || hotel;
            });
            
            if (hasBuildingsInGroup) return;
        }

        // No se puede hipotecar una propiedad que tenga construcciones.
        const houses = property.houses || 0;

        if (houses > 0 || property.hotel) return;

        // El banco paga el valor de la hipoteca.
        player.money += mortgageValue;

        property.mortgaged = true;

        players[playerId] = player;
        properties[propertyId] = property;
        roomData.players = players;
        roomData.properties = properties;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        mortgageApplied = true;
        return roomData;
    }).then((result) => {
        if (!mortgageApplied || !result.committed) {
            throw new Error(
                "No se pudo hipotecar la propiedad."
            );
        }

        console.log( "Propiedad hipotecada correctamente en Firebase." );
        return result.snapshot.val();
    });
}

export function unmortgagePropertyInCloud( roomId, propertyId, playerId, unmortgageCost, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let unmortgageApplied = false;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];
        const property = properties[propertyId];

        if (!player) return;
        if (!property) return;
        // Verificar propietario
        if (property.ownerId !== playerId) return;
        // Solo se puede deshipotecar una propiedad hipotecada
        if (!property.mortgaged) return;
        // Verificar dinero suficiente
        if (player.money < unmortgageCost) return;

        player.money -= unmortgageCost;
        property.mortgaged = false;

        players[playerId] = player;
        properties[propertyId] = property;
        roomData.players = players;
        roomData.properties = properties;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        unmortgageApplied = true;
        return roomData;
    }).then((result) => {
        if (!unmortgageApplied || !result.committed) {
            throw new Error(
                "No se pudo deshipotecar la propiedad."
            );
        }

        console.log( "Propiedad deshipotecada correctamente en Firebase." );
        return result.snapshot.val();
    });
}

export function buildHouseInCloud( roomId, propertyId, playerId, houseCost, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let buildApplied = false;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];
        const property = properties[propertyId];

        // El jugador debe existir
        if (!player) return;
        // La propiedad debe existir
        if (!property) return;
        // El jugador debe ser el propietario
        if (property.ownerId !== playerId) return;
        // No se puede construir sobre un hotel
        if (property.hotel) return;

        const houses = property.houses || 0;

        // Máximo de 4 casas
        if (houses >= 4) return;
        // Verificar dinero dentro de Firebase
        if (player.money < houseCost) return;

        // Descontar el precio de la casa
        player.money -= houseCost;
        // Construir la casa
        property.houses = houses + 1;

        // Asegurar que exista el campo hotel
        if (property.hotel === undefined) property.hotel = false;

        properties[propertyId] = property;
        players[playerId] = player;
        roomData.players = players;
        roomData.properties = properties;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        buildApplied = true;
        return roomData;
    }).then((result) => {
        if (!buildApplied || !result.committed) {
            throw new Error(
                "No se pudo construir la casa en Firebase."
            );
        }

        console.log( "Casa construida correctamente en Firebase." );
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
        
        if (houses - 1 < maximumOtherHouses) return;

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
        if (!property.hotel) return;

        player.money += sellValue;

        property.hotel = false;
        property.houses = 4;
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
                "No se pudo vender el hotel."
            );
        }

        console.log( "Hotel vendido correctamente en Firebase." );
        return result.snapshot.val();
    });
}

export function buildHotelInCloud( roomId, propertyId, playerId, hotelCost, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);
    let buildApplied = false;

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        const players = roomData.players || {};
        const properties = roomData.properties || {};
        const player = players[playerId];
        const property = properties[propertyId];

        // El jugador debe existir
        if (!player) return;
        // La propiedad debe existir
        if (!property) return;
        // El jugador debe ser el propietario
        if (property.ownerId !== playerId) return;
        // No se puede construir otro hotel
        if (property.hotel) return;

        const houses = property.houses || 0;

        // Se necesitan 4 casas
        if (houses < 4) return;
        // Verificar dinero dentro de Firebase
        if (player.money < hotelCost) return;

        // Descontar el precio del hotel
        player.money -= hotelCost;
        // Convertir las 4 casas en hotel
        property.houses = 0;
        property.hotel = true;

        properties[propertyId] = property;
        players[playerId] = player;
        roomData.players = players;
        roomData.properties = properties;

        if (!roomData.gameplay) roomData.gameplay = {};

        roomData.gameplay.lastAction = logMessage;
        buildApplied = true;
        return roomData;
    }).then((result) => {
        if (!buildApplied || !result.committed) {
            throw new Error(
                "No se pudo construir el hotel en Firebase."
            );
        }

        console.log( "Hotel construido correctamente en Firebase." );
        return result.snapshot.val();
    });
}

export function payRentInCloud( roomId, payerId, ownerId, rentAmount, logMessage ) {
    const roomRef = ref(db, `rooms/${roomId}`);

    // Validar el importe antes de iniciar la transacción.
    if (!Number.isFinite(rentAmount) || rentAmount < 0) {
        return Promise.reject( new Error("El importe del alquiler no es válido.") );
    }

    return runTransaction(roomRef, (roomData) => {
        if (!roomData) return;

        // No procesar alquileres después de finalizar la partida.
        if (roomData.meta?.status === "finished") return;

        const players = roomData.players || {};
        const payer = players[payerId];
        const owner = players[ownerId];

        // Verificar que ambos jugadores existan.
        if (!payer || !owner) return;
        // No se permite pagarse alquiler a uno mismo.
        if (payerId === ownerId) return;
        // Si no alcanza el dinero, cancelar esta transacción sin modificar el saldo de ninguno de los jugadores.
        if (payer.money < rentAmount) return;

        // Transferir el dinero dentro de la misma transacción.
        payer.money -= rentAmount;
        owner.money += rentAmount;

        players[payerId] = payer;
        players[ownerId] = owner;
        roomData.players = players;

        if (!roomData.gameplay) roomData.gameplay = {};
        roomData.gameplay.lastAction = logMessage;
        return roomData;
    }).then((result) => {
        const snapshot = result.snapshot.val();

        // La transferencia se confirmó en Firebase.
        if (result.committed) {
            return {
                success: true,
                bankrupt: false,
                snapshot
            };
        }

        // La transacción no se confirmó. Comprobar si la causa fue que el jugador no tenía dinero suficiente
        const payer = snapshot?.players?.[payerId];
        const owner = snapshot?.players?.[ownerId];

        if (
            snapshot?.meta?.status !== "finished" &&
            payer &&
            owner &&
            payerId !== ownerId &&
            Number.isFinite(payer.money) &&
            payer.money < rentAmount
        ) {
            return {
                success: false,
                bankrupt: true
            };
        }

        // No confundir un jugador inexistente u otro fallo con una bancarrota.
        throw new Error(
            "No se pudo completar el pago del alquiler. " +
            "Verifica el estado de los jugadores y la sala."
        );
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

export function handleBankruptcyInCloud( roomId, debtorId, creditorId, logMessage ) {
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

        // Guardar el orden y el turno antes de eliminar al jugador.
        const gameplay = roomData.gameplay || {};
        const playerOrderBefore = Object.keys(players);
        const debtorIndex = playerOrderBefore.indexOf(debtorId);
        const currentTurnIndex = Number.isInteger(gameplay.currentTurnIndex) ? gameplay.currentTurnIndex : 0;
        const debtorWasActive = debtorIndex === currentTurnIndex;

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
            if ( debtorIndex !== -1 && debtorIndex < currentTurnIndex ) djustedIndex--;

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