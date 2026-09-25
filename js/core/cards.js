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

export function applyBasicCardEffect(card, player) {

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

        default:
            return null;
    }
}