const Stream = require('stream');

exports.install = function() {
	ROUTE('SOCKET /', external, 1024 * 5);
};

function external(id) {

	var self = this;
	var callbacks = {};
	var indexer = 0;

	MAIN.external[id] = self;

	self.autodestroy(function() {
		MAIN.external = {};
	});

	self.on('open', function(client) {

		var id = client.query.id;

		if (id && id.substring(0, 8) !== 'local://')
			id = 'local://' + id;

		var project = MAIN.projects.findItem('path', id);
		if (!project || !project.isexternal || !project.islocal) {
			client.close(4001);
			return;
		}

		if (MAIN.external[project.id]) {
			client.close(4001);
			return;
		}

		client.verified = true;
		client.projectid = project.id;
		MAIN.external[project.id] = client;
		client.sendcode = function(msg, callback, responsetype) {

			// 1: json
			// 2: text
			// 3: stream
			// 4: raw text without compression

			msg.callbackid = (indexer++) + '';
			callbacks[msg.callbackid] = { type: responsetype, callback: callback };
			client.send(msg);
		};

		client.send({ TYPE: 'init', version: MAIN.version, name: CONF.name });
	});

	self.on('close', function(client) {
		if (client.verified)
			delete MAIN.external[client.projectid];
	});

	self.on('message', function(client, msg) {

		switch (msg.TYPE) {
			case 'init':
				client.VERSION = msg.version;
				client.confirmed = true;
				break;
		}

		if (client.verified && client.confirmed) {
			var obj = callbacks[msg.callbackid || '_'];
			if (obj) {
				delete callbacks[msg.callbackid];
				if (msg.error)
					obj.callback(ErrorBuilder.assign(msg.error), null, true);
				else {

					if (obj.type === 4) {
						obj.callback(null, msg.response, true);
					} else if (obj.type === 2) {
						F.Zlib.inflate(Buffer.from(msg.response.data, 'base64'), function(err, buffer) {
							msg = buffer ? buffer.toString('utf8') : '';
							obj.callback(err, msg, true);
						});
					} else if (obj.type === 3) {
						F.Zlib.inflate(Buffer.from(msg.response.data, 'base64'), function(err, buffer) {
							if (buffer) {
								msg.stream = new Stream.Readable();
								msg.stream.push(buffer);
								msg.stream.push(null);
							} else
								msg.status = 400;
							obj.callback(err, msg, true);
						});
					} else
						obj.callback(null, msg.response, true);
				}
			}
		}
	});
}