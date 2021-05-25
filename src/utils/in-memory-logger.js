const Transport = require('winston-transport');
const util = require('util');

//
// Inherit from `winston-transport` so you can take advantage
// of the base functionality and `.exceptions.handle()`.
//
module.exports = class InMemoryLogTransport extends Transport {
  constructor(opts) {
    super(opts);
		this.max = 100;
		this.lock = false;
		if(opts.max && !isNaN(opts.max)) {
			this.max = opts.max;
		}

		if(opts.level) {
			this.level = opts.level;
		}

		this.queue = [];
		this.cache = [];
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

		this.queue.push(info);

    callback();
  }

	getLogAsync(nLines) {
		return new Promise((resolve, reject) => {
			if(this.lock) {
				return resolve(this.cache);
			}

			this.lock = true;

			if(nLines > this.max) {
				nLines = this.max;
			}

			while(this.queue.length > this.max) {
				this.queue.shift();
			}

			if(nLines >= this.queue.length) {
				this.cache = this.queue.slice(this.queue.length - nLines).map((l) => {
					return l.timestamp + ' ' + l.level + ' [' + l.label + '] ' + l.message;
				});
				resolve(this.cache);
				this.lock = false;
				return;
			}

			this.cache = this.queue.slice(this.queue.length - nLines).map((l) => {
				return l.timestamp + ' ' + l.level + ' [' + l.label + '] ' + l.message;
			});
			resolve(this.cache);
			this.lock = false;
		}).catch((ex) => {
			this.lock = false;
		});
	}
};
