const sorteios = require('./src/services/sorteios');
sorteios.startRaffle('pão');
sorteios.handleMessage({ chatmessage: 'eu quero pão', chatname: 'TestUser1', source: 'manual' });
sorteios.handleMessage({ chatmessage: 'PÃO com manteiga', chatname: 'TestUser2', source: 'manual' });
sorteios.handleMessage({ chatmessage: 'pao', chatname: 'TestUser3', source: 'manual' });
sorteios.handleMessage({ chatmessage: 'não gosto', chatname: 'TestUser4', source: 'manual' });
console.log(sorteios.getState());
