import { getSquareById } from './board.js';

export const CHANCE_CARDS = [
    { id: 0, text: "Avance hasta SALIDA (Cobra $200)", type: "move_to", targetId: 0 },
    { id: 1, text: "Avance hasta la Avenida Illinois", type: "move_to", targetId: 24 },
    { id: 2, text: "Avance hasta San Carlos Plaza", type: "move_to", targetId: 11 },
    { id: 3, text: "Avance al servicio público más cercano. Si no tiene dueño, puedes comprarlo. Si tiene dueño, lanza los dados y paga 10 veces lo que salga.", type: "nearest_utility" },
    { id: 4, text: "Avance al ferrocarril más cercano y paga al dueño el doble del alquiler.", type: "nearest_railroad" },
    { id: 5, text: "El banco te paga un dividendo de $50", type: "receive_money", amount: 50 },
    { id: 6, text: "Haga reparaciones generales en todas sus propiedades. Pague $25 por casa y $100 por hotel.", type: "property_tax", houseCost: 25, hotelCost: 100 },
    { id: 7, text: "Pague una multa escolar de $15", type: "pay_money", amount: 15 },
    { id: 8, text: "Retroceda tres casillas", type: "move_back", steps: 3 },
    { id: 9, text: "Vaya directamente a la Cárcel. No pase por SALIDA. No cobre $200.", type: "go_to_jail" },
    { id: 10, text: "Queda libre de la cárcel. Esta tarjeta puede conservarse hasta que se necesite.", type: "get_out_of_jail_free" },
    { id: 11, text: "Avance hasta Paseo Tablado", type: "move_to", targetId: 39 },
    { id: 12, text: "La corporación te nombra presidente. Paga $50 a cada jugador.", type: "pay_each_player", amount: 50 },
    { id: 13, text: "Tu seguro de vida vence. Cobra $100", type: "receive_money", amount: 100 }
];

export const COMMUNITY_CHEST_CARDS = [
    { id: 0, text: "Avance hasta SALIDA (Cobra $200)", type: "move_to", targetId: 0 },
    { id: 1, text: "Error del banco a tu favor. Cobra $200", type: "receive_money", amount: 200 },
    { id: 2, text: "Gastos de doctor. Paga $50", type: "pay_money", amount: 50 },
    { id: 3, text: "De la venta de acciones obtienes $50", type: "receive_money", amount: 50 },
    { id: 4, text: "Queda libre de la cárcel. Esta tarjeta puede conservarse hasta que se necesite.", type: "get_out_of_jail_free" },
    { id: 5, text: "Vaya directamente a la Cárcel. No pase por SALIDA. No cobre $200.", type: "go_to_jail" },
    { id: 6, text: "Gran apertura de la ópera. Recibe $50 de cada jugador por asientos de noche de estreno.", type: "receive_from_each_player", amount: 50 },
    { id: 7, text: "Fondo de Navidad madura. Cobra $100", type: "receive_money", amount: 100 },
    { id: 8, text: "Devolución del impuesto sobre la renta. Cobra $200", type: "receive_money", amount: 200 },
    { id: 9, text: "Es tu cumpleaños. Recibe $10 de cada jugador.", type: "receive_from_each_player", amount: 10 },
    { id: 10, text: "Vence tu póliza de seguro de vida. Cobra $100", type: "receive_money", amount: 100 },
    { id: 11, text: "Pague una multa del hospital de $100", type: "pay_money", amount: 100 },
    { id: 12, text: "Pague impuestos escolares de $150", type: "pay_money", amount: 150 },
    { id: 13, text: "Recibe $25 por servicios de consultoría", type: "receive_money", amount: 25 },
    { id: 14, text: "Te asignan dinero para reparaciones de la calle. $40 por casa, $115 por hotel.", type: "property_tax", houseCost: 40, hotelCost: 115 },
    { id: 15, text: "Has ganado el segundo premio en un concurso de belleza. Cobra $10", type: "receive_money", amount: 10 },
    { id: 16, text: "Heredas $100", type: "receive_money", amount: 100 }
];

// Función útil para mezclar un array (Algoritmo Fisher-Yates)
export function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Clase para controlar el mazo durante la partida
export class CardDeck {
    constructor(cards) {
        this.originalCards = cards;
        this.currentDeck = shuffleDeck(cards);
    }

    drawCard() {
        if (this.currentDeck.length === 0) {
            this.currentDeck = shuffleDeck(this.originalCards);
        }
        return this.currentDeck.shift(); // Saca la carta de arriba
    }
}

export function applyBasicCardEffect(card, player, propertiesState = {} ) {

    switch (card.type) {

        case "receive_money":
            player.money += card.amount;
            return `${player.name} recibió $${card.amount}.`;

        case "pay_money":
            if (player.money < card.amount) {
                throw new Error(
                    `${player.name} no tiene suficiente dinero para pagar $${card.amount}.`
                );
            }
            player.money -= card.amount;
            return `${player.name} pagó $${card.amount}.`;

        case "property_tax": {
            let totalCost = 0;

            for (const propertyId of player.properties || []) {
                const buildings = propertiesState[propertyId] || {};
                const houses = buildings.houses || 0;
                const hotel = buildings.hotel ? 1 : 0;
            
                totalCost += houses * card.houseCost;
                totalCost += hotel * card.hotelCost;
            }

            if (player.money < totalCost) {
                return {
                    bankrupt: true,
                    totalCost,
                    message: `${player.name} no pudo pagar $${totalCost} ` + `por las reparaciones de sus propiedades.`
                };
            }

            player.money -= totalCost;
            return `${player.name} pagó $${totalCost} por reparaciones de sus propiedades.`;
        }

        case "move_back": {
            const oldPosition = player.position;
            player.position = (player.position - card.steps + 40) % 40;
            const square = getSquareById(player.position);
            return `${player.name} retrocedió ${card.steps} casillas y llegó a ${square.name}.`;
        }


        case "move_to": {
            const oldPosition = player.position;
            player.position = card.targetId;
            const square = getSquareById(player.position);
            // Si el movimiento pasa por SALIDA, cobra $200.
            if (player.position < oldPosition) {
                player.money += 200;
                return `${player.name} avanzó hasta ${square.name} y cobró $200 por pasar por SALIDA.`;
            }
            return `${player.name} avanzó hasta ${square.name}.`;
        }

        case "go_to_jail":
            player.position = 10;
            player.isJailed = true;
            player.jailTurns = 0;
            return `${player.name} fue enviado directamente a la cárcel.`;

        case "get_out_of_jail_free":
            player.getOutOfJailFreeCards = (player.getOutOfJailFreeCards || 0) + 1;
            return `${player.name} obtuvo una carta para salir de la cárcel.`;

        case "nearest_railroad": {
            const railroad = findNearestSquare( player.position, "railroad" );
        
            if (!railroad) {
                throw new Error(
                    "No se encontró ningún ferrocarril."
                );
            }
            player.position = railroad.id;
            return `${player.name} avanzó hasta ${railroad.name}.`;
        }

        case "nearest_utility": {
            const utility = findNearestSquare( player.position, "utility" );
        
            if (!utility) {
                throw new Error(
                    "No se encontró ningún servicio público."
                );
            }
            player.position = utility.id;
            return `${player.name} avanzó hasta ${utility.name}.`;
        }

        default:
            return null;
    }
}

export function applyPlayerInteractionCardEffect( card, player, allPlayers ) {
    switch (card.type) {

        case "pay_each_player": {
            const otherPlayers = Object.values(allPlayers).filter(otherPlayer => otherPlayer.id !== player.id);
            const totalPayment = card.amount * otherPlayers.length;

            if (player.money < totalPayment) {
                throw new Error(
                    `${player.name} no tiene suficiente dinero para pagar $${totalPayment}.`
                );
            }

            player.money -= totalPayment;

            otherPlayers.forEach(otherPlayer => {
                otherPlayer.money += card.amount;
            });

            return `${player.name} pagó $${card.amount} a cada jugador.`;
        }

        case "receive_from_each_player": {
            const otherPlayers = Object.values(allPlayers).filter(otherPlayer => otherPlayer.id !== player.id);
            const totalReceived = card.amount * otherPlayers.length;

            otherPlayers.forEach(otherPlayer => {
                if (otherPlayer.money >= card.amount) {
                    otherPlayer.money -= card.amount;
                } else {
                    throw new Error(
                        `${otherPlayer.name} no tiene suficiente dinero para pagar $${card.amount}.`
                    );
                }
            });

            player.money += totalReceived;

            return `${player.name} recibió $${card.amount} de cada jugador.`;
        }

        default:
            return null;
    }
}

function findNearestSquare(playerPosition, type) {
    const squares = [];

    for (let i = 0; i < 40; i++) {
        const square = getSquareById(i);
        if (square && square.type === type) squares.push(square);
    }

    if (squares.length === 0) return null;

    // Calcula la distancia avanzando por el tablero
    let nearestSquare = null;
    let shortestDistance = 40;

    for (const square of squares) {
        const distance = (square.id - playerPosition + 40) % 40;

        // Si está exactamente en la misma casilla, busca la siguiente vuelta.
        const adjustedDistance = distance === 0 ? 40 : distance;

        if (adjustedDistance < shortestDistance) {
            shortestDistance = adjustedDistance;
            nearestSquare = square;
        }
    }
    return nearestSquare;
}

function findPropertyOwner(squareId, allPlayers) {
    for (const player of Object.values(allPlayers)) {
        if (player.properties?.includes(squareId)) return player;
    }

    return null;
}

export function applySpecialCardEffect( card, player, allPlayers ) {
    switch (card.type) {

        case "nearest_railroad": {
            const railroad = findNearestSquare( player.position, "railroad" );

            if (!railroad) {
                throw new Error(
                    "No se encontró ningún ferrocarril."
                );
            }

            player.position = railroad.id;
            const owner = findPropertyOwner( railroad.id, allPlayers );

            // El jugador llegó a un ferrocarril sin dueño.
            if (!owner) {
                return {
                    message:
                        `${player.name} avanzó hasta ${railroad.name}. El ferrocarril no tiene dueño.`,
                    needsPurchase: true,
                    square: railroad
                };
            }

            // El jugador llegó a su propio ferrocarril.
            if (owner.id === player.id) {
                return {
                    message:
                        `${player.name} avanzó hasta ${railroad.name}, que ya es de su propiedad.`,
                    needsPurchase: false,
                    rentToPay: 0,
                    square: railroad
                };
            }

            // El ferrocarril tiene otro propietario.
            const baseRent = railroad.rent?.[0] || 25;
            const doubleRent = baseRent * 2;

            if (player.money < doubleRent) {
                throw new Error(
                    `${player.name} no tiene suficiente dinero para pagar $${doubleRent}.`
                );
            }

            player.money -= doubleRent;
            owner.money += doubleRent;

            return {
                message:
                    `${player.name} pagó $${doubleRent} a ${owner.name} por caer en ${railroad.name}.`,
                needsPurchase: false,
                rentToPay: doubleRent,
                square: railroad,
                owner
            };
        }

        case "nearest_utility": {
            const utility = findNearestSquare( player.position, "utility" );
        
            if (!utility) {
                throw new Error(
                    "No se encontró ningún servicio público."
                );
            }
        
            player.position = utility.id;
            const owner = findPropertyOwner( utility.id, allPlayers );
        
            // Servicio público sin dueño
            if (!owner) {
                return {
                    message:
                        `${player.name} avanzó hasta ${utility.name}. El servicio público no tiene dueño.`,
                    needsPurchase: true,
                    square: utility
                };
            }
        
            // El jugador llegó a su propio servicio público
            if (owner.id === player.id) {
                return {
                    message:
                        `${player.name} avanzó hasta ${utility.name}, que ya es de su propiedad.`,
                    needsPurchase: false,
                    rentToPay: 0,
                    square: utility
                };
            }
        
            // Servicio público propiedad de otro jugador
            const die1 = Math.floor(Math.random() * 6) + 1;
            const die2 = Math.floor(Math.random() * 6) + 1;
            const total = die1 + die2;
        
            const payment = total * 10;
        
            if (player.money < payment) {
                throw new Error(
                    `${player.name} no tiene suficiente dinero para pagar $${payment}.`
                );
            }
        
            player.money -= payment;
            owner.money += payment;
        
            return {
                message:
                    `${player.name} avanzó hasta ${utility.name}, sacó ${die1} y ${die2} (${total}) y pagó $${payment} a ${owner.name}.`,
                needsPurchase: false,
                rentToPay: payment,
                dice: [die1, die2],
                square: utility,
                owner
            };
        }

        default:
            return null;
    }
}