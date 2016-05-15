var Promise = require('bluebird');
var request = require('request');
var $ = require('cheerio');
var url = require('url');
var http = require('http'); //remove

var CHAMPIONSHIP_URL = 'http://globoesporte.globo.com/futebol/brasileirao-serie-%serie%/';
var ROUND_URL = 'http://globoesporte.globo.com%widget%%round%/jogos.html';

function fetchChampionship (serie) {
  return fetch(CHAMPIONSHIP_URL.replace(/%serie%/, serie));
}

function urlForRound (widget) {
  return ROUND_URL.replace(/%widget%/, widget);
}

function fetchRound (url, round) {
  return fetch(url.replace(/%round%/, round));
}

function fetch (url) {
  return new Promise(function (resolve, reject) {
    request(url, function (error, response, body) {
      if (error || response.statusCode !== 200) {
        return reject(error || response.statusCode);
      }

      return resolve({url: url, context: $(body)});
    });
  });
}

function grabRound (context) {
  var round = $('.tabela-navegacao-jogos .tabela-navegacao-seletor', context);
  var current = parseInt(round.attr('data-rodada'), 10);
  var last = parseInt(round.attr('data-rodadas-length'), 10);

  return {
    current: current,
    last: last,
  };
}

function grabMatches (context) {
  var matches = []
  $('.placar-jogo', context).each(function () {
    matches.push(grabMatch(this));
  });

  return matches;
}

function grabMatch (context) {
  var homeCtx = $('span.placar-jogo-equipes-mandante', context);
  var guestCtx = $('span.placar-jogo-equipes-visitante', context);

  return {
    home: {
      name: $('meta', homeCtx).attr('content'),
      shield: $('img', homeCtx).attr('src'),
      score: $('.placar-jogo-equipes-placar-mandante', context).text(),
    },
    guest: {
      name: $('meta', guestCtx).attr('content'),
      shield: $('img', guestCtx).attr('src'),
      score: $('.placar-jogo-equipes-placar-visitante', context).text(),
    },
    stadium: $('.placar-jogo-informacoes-local', context).text(),
    datetime: grabMatchDatetime(context),
    url: $('a.placar-jogo-link', context).attr('href'),
  };
}

function grabMatchDatetime (context) {
  var date = $('meta[itemprop="startDate"]', context).attr('content');
  var time = $('div.placar-jogo-informacoes', context)
    .text()
    .match(/[0-9]{2}\:[0-9]{2}/);

  if (time === null) {
    return new Date(date + ' 00:00:00');
  }

  var date = new Date(date + ' ' + time.shift() + ':00');

  date.setHours(date.getHours() + 3);

  return date;
}

function grabWidgetUrl (context) {
  return $('aside.lista-de-jogos', context).attr('data-url-pattern-navegador-jogos');
}

function isValidSerie (serie) {
  return ['a', 'b'].indexOf(serie.toLowerCase()) !== -1;
}

function parseChampionship (data) {

}

function fetchChampionshipAndParse (serie) {
  return fetchChampionship(serie)
    .then(parseChampionship);
}

function parseChampionship (data) {
  var round = grabRound(data.context);
  var currentRound = {
    round: round.current,
    matches: grabMatches(data.context),
  };

  return {
    url: data.url,
    widget: grabWidgetUrl(data.context),
    round: grabRound(data.context),
    rounds: [currentRound],
  };
}

function fetchRoundsAndParse (championship) {
  var rounds = roundsAsArray(
    championship.round.current,
    championship.round.last
  );
  var url = urlForRound(championship.widget);

  return Promise.map(
    rounds,
    fetchRoundAndParse.bind(null, url),
    { concurrency: 2 }
  ).then(joinRoundsWithChampionship.bind(null, championship)
  );
}

function fetchRoundAndParse (url, round) {
  return fetchRound(url, round)
    .then(parseRound.bind(null, round));
}

function joinRoundsWithChampionship (championship, rounds) {
  championship.rounds = championship.rounds.concat(rounds);

  return sortChampionshipRounds(championship);
}

function sortChampionshipRounds (championship) {
  championship.rounds = championship.rounds.sort(function (a, b) {
    if (a.round > b.round) {
      return 1;
    }

    return -1;
  });

  return championship;
}


function fetchChampionshipRoundsAndParseIfNeeded (cache, serie) {
  var result;

  if (cache.has(serie)) {
    result = Promise.resolve(cache.get(serie));
  }

  if (cache.isValid(serie)) {
    return result;
  }

  var promise = fetchChampionshipRoundsAndParse(serie)
    .then(function (data) {
      cache.write(serie, data);
      return data;
    });

  if (result) {
    return result;
  }

  return promise;
}

function fetchChampionshipRoundsAndParse (serie) {
  return fetchChampionshipAndParse(serie)
    .then(fetchRoundsAndParse);
}

function parseRound (round, data) {
  return {
    round: round,
    matches: grabMatches(data.context),
  };
};

function roundsAsArray (current, last) {
  var rounds = [];
  for (var i=1; i<=last; i++) {
    if (i === current) {
      continue;
    }

    rounds.push(i);
  }

  return rounds;
}

function cache (expiration) {
  var storage = {};

  return {
    has: function (serie) {
      return typeof storage[serie] !== 'undefined';
    },
    isValid: function (serie) {
      if (!this.has(serie)) {
        return false;
      }

      return new Date().getTime() < storage[serie].expiration;
    },
    write: function (serie, data) {
      storage[serie] = {
        expiration: new Date().getTime() + expiration,
        data: data,
      };
    },
    get: function (serie) {
      return storage[serie].data;
    },
    size: Object.keys(storage),
  };
}


var internalCache = cache(900000); //15 minutes
var headers = {
  'Content-Type': 'application/json; charset=utf-8'
};


function app (context, req, res) {
  var serie = context.data.serie;
  if (!serie || !isValidSerie(serie)) {
    res.writeHead(400, headers)

    return res.end(
      JSON.stringify({
        error: {
          msg: 'You must pass as query string the championship serie'
        }
      })
    );
  }

  fetchChampionshipRoundsAndParseIfNeeded(internalCache, serie.toLowerCase())
    .then(function (data) {
      res.writeHead(200, headers);
      res.end(JSON.stringify(data))
    })
    .catch(function (err) {
      if (!isNaN(parseInt(err, 10))) {
        res.writeHead(err);
        return res.end();
      }

      res.writeHead(500);

      res.end(JSON.stringify({
        error: {
          msg: 'Something went wrong :(',
          error: err.stack,
        }
      }));
    });
}


module.exports = app;