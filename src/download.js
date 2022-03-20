'use strict';

const net = require('net');
const Queue = require('./queue');
const Pieces = require('./pieces');
const tracker = require('./tracker');
const message = require('./message');

module.exports = torrent => {
    tracker.getPeers(torrent, peers => {
        const pieces = new Pieces(torrent);
        peers.forEach(peer => download(peer, torrent, pieces));
    });
};

function download(peer, torrent, pieces) {
    const socket = new net.Socket();
    socket.on('error', console.log);
    socket.connect(peer.port, peer.ip, () => {
        socket.write(message.buildHandshake(torrent));
    });

    const queue = new Queue(torrent);
    onWholeMsg(socket, msg => msgHandler(msg, socket, pieces, queue));
}

function onWholeMsg(socket, callback) {
    let savedBuf = Buffer.alloc(0);
    let handshake = true;

    socket.on('data', recvBuf => {
        const msgLen = () => handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;  // calculates the length of a whole message
        savedBuf = Buffer.concat([savedBuf, recvBuf]);

        while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
            callback(savedBuf.slice(0, msgLen()));
            savedBuf = savedBuf.slice(msgLen());
            handshake = false;
        }
    });
}

function msgHandler(msg, socket, pieces, queue) {
    if (isHandshake(msg)) {
        socket.write(message.buildInterested());
    } else {
        const m = message.parse(msg);

        if (m.id === 0) chokeHandler(socket);
        if (m.id === 1) unchokeHandler(socket, pieces, queue);
        if (m.id === 4) haveHandler(m.payload);
        if (m.id === 5) bitfieldHandler(m.payload);
        if (m.id === 7) pieceHandler(m.payload);
    }
}

function haveHandler(payload, socket, requested, queue) {
    // ...
    const pieceIndex = payload.readUInt32BE(0);
    queue.push(pieceIndex);

    if (!requested[pieceIndex]) socket.write(message.buildRequest(...));
    requested[pieceIndex] = true;

    if (queue.length === 1) requestPiece(socket, requested, queue);
}

function pieceHandler(payload, socket, requested, queue) {
    // ...
    queue.shift();
    requestPiece(socket, requested, queue);
}

function requestPiece(socket, pieces, queue) {
    if (queue.choked) return null;

    while (queue.queue.length) {
        const pieceBlock = queue.deque();
        if (pieces.needed(pieceBlock)) {
            socket.write(message.buildRequest(pieceBlock));
            pieces.addRequested(pieceBlock);
            break;
        }
    }
}

function isHandshake(msg) {
    return msg.length === msg.readUInt8(0) + 49 && msg.toString('utf8', 1) === 'BitTorrent protocol';
}

function unchokeHandler(socket, pieces, queue) {
    queue.choked = false;
    requestPiece(socket, pieces, queue);
}

function chokeHandler(socket) {
    socket.end();
}

function bitfieldHandler(payload) { ... }
