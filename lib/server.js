/* jshint node:true */
'use strict';

/*!
 * Node.js client/server library for the E1.31 (sACN) protocol
 * Hugo Hromic - http://github.com/hhromic
 *
 * Copyright 2016 Hugo Hromic
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var dgram = require('dgram');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var e131 = require('./e131');

// E1.31 server object constructor
function Server(universes, port) {
  if (this instanceof Server === false) {
    return new Server(universes, port);
  }
  EventEmitter.call(this);

  if (universes instanceof Object || universes === undefined) {
    const config = universes || {};
    if (config.universes !== undefined && !Array.isArray(config.universes)) {
      config.universes = [config.universes];
    }

    this.universes = config.universes || [];
    this.port = config.port || port || e131.DEFAULT_PORT;
    this._mcastif = config.mcastif;
    this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this._socket.bind({ port: this.port, address: config.bind }, () => {
      if (this._mcastif !== undefined)
        this._socket.setMulticastInterface(this._mcastif);
      if (config.loopback === true) {
        this._socket.setMulticastLoopback(true);
      }
      if (this.universes !== undefined) {
        this.universes.forEach((universe) => {
          this._lastSequenceNumber[universe] = 0;
          var multicastGroup = e131.getMulticastGroup(universe);
          this._socket.addMembership(multicastGroup, this._mcastif);
        });
      }
    });
  } else {
    if (universes !== undefined && !Array.isArray(universes)) {
      universes = [universes];
    }
    this.universes = universes || [0x01];
    this.port = port || e131.DEFAULT_PORT;
    this._socket = dgram.createSocket('udp4');
    this._socket.bind(this.port, function onListening() {
      self.universes.forEach(function (universe) {
        var multicastGroup = e131.getMulticastGroup(universe);
        self._socket.addMembership(multicastGroup);
      });
    });
  }
  this._lastSequenceNumber = {};
  var self = this;
  this._socket.on('error', function onError(err) {
    self.emit('error', err);
  });
  this._socket.on('listening', function onListening() {
    self.emit('listening');
  });
  this._socket.on('close', function onClose() {
    self.emit('close');
  });
  this._socket.on('message', function onMessage(msg) {
    var packet = new e131.Packet(msg);
    var validation = packet.validate();
    if (validation !== packet.ERR_NONE) {
      self.emit('packet-error', packet, validation);
      return;
    }
    if (packet.discard(self._lastSequenceNumber[packet.getUniverse()])) {
      self.emit('packet-out-of-order', packet);
    } else {
      self.emit('packet', packet);
    }
    self._lastSequenceNumber[packet.getUniverse()] = packet.getSequenceNumber();
  });
}

// close a listening E1.31 server
Server.prototype.close = function close() {
  this._socket.close();
};

Server.prototype.addUniverses = function (universes) {
  universes.forEach((universe) => {
    if (this.universes.includes(universe)) return;
    this.universes.push(universe);
    this._lastSequenceNumber[universe] = 0;
    this._socket.addMembership(e131.getMulticastGroup(universe), this._mcastif);
  });
};

Server.prototype.dropUniverses = function (universes) {
  universes.forEach((universe) => {
    if (!this.universes.includes(universe)) return;
    this.universes.splice(this.universes.indexOf(universe), 1);
    delete this._lastSequenceNumber[universe];
    this._socket.dropMembership(
      e131.getMulticastGroup(universe),
      this._mcastif
    );
  });
};

// server object inherits from EventEmitter
util.inherits(Server, EventEmitter);

// module exports
module.exports = Server;
