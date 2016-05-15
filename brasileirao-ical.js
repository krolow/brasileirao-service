var request = require('request');
var Handlebars = require('handlebars');
var crypto = require('crypto');


var CHAMPIONSHIP_URL = 'https://webtask.it.auth0.com/api/run/wt-krolow-gmail_com-0/brasileirao?serie=%serie%';


function fetchChampionship (serie) {
  return new Promise(function (resolve, reject) {
    request(
      {
        url: CHAMPIONSHIP_URL.replace(/%serie%/, serie),
        json: true,
        timeout: 130000,
      },
      function (error, response, body) {
        if (error || response.statusCode !== 200) {
          return reject(error || response.statusCode);
        }

        return resolve(body);
      }
    );
  });
}

function grabTeamMatches (rounds, team) {
  return rounds
    .reduce(function (acc, curr) {
      return acc.concat(
        addRoundToMatches(
          curr.round,
          filterTeamMatches(team, curr.matches)
        )
      );
    }, []);
}

function addRoundToMatches (round, matches) {
  return matches.map(function (match) {
    match.round = round;

    return match;
  });
}

function filterTeamMatches (team, matches) {
  return matches.filter(isTeamPlayingMatch.bind(null, team));
}

function isTeamPlayingMatch (team, match) {
  var expression = new RegExp('^' + team + '.*', 'gi');

  return expression.test(match.home.name) || expression.test(match.guest.name);
}

function filterMatchesWithDateAndTime (matches) {
  return matches.filter(function (match) {
    var date = new Date(match.datetime);

    return date.getUTCHours() !== 0;
  });
}

function getTemplate () {
  return Handlebars.compile("\
BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
NAME:Calendário Brasileirao {{serie}} - Jogos {{team}}\r\n\
X-WR-CALNAME;VALUE=TEXT:Calendário Brasileirao {{serie}} - Jogos {{team}}\r\n\
X-WR-CALDESC:Calendário Brasileirao {{serie}} - Jogos {{team}}\r\n\
X-GOOGLE-CALENDAR-CONTENT-TITLE:Calendário Brasileirao {{serie}} - Jogos {{team}}\r\n\
CALSCALE:GREGORIAN\r\n\
METHOD:PUBLISH\r\n\
BEGIN:VTIMEZONE\r\n\
REFRESH-INTERVAL;VALUE=DURATION:PT12H\r\n\
X-PUBLISHED-TTL:PT12H\r\n\
TZID:America/Sao_Paulo\r\n\
TZURL:http://tzurl.org/zoneinfo-outlook/America/Sao_Paulo\r\n\
X-LIC-LOCATION:America/Sao_Paulo\r\n\
BEGIN:DAYLIGHT\r\n\
TZOFFSETFROM:-0300\r\n\
TZOFFSETTO:-0200\r\n\
TZNAME:BRST\r\n\
DTSTART:19701018T000000\r\n\
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=3SU\r\n\
END:DAYLIGHT\r\n\
BEGIN:STANDARD\r\n\
TZOFFSETFROM:-0300\r\n\
TZOFFSETTO:-0300\r\n\
TZNAME:BRT\r\n\
DTSTART:19700215T000000\r\n\
RRULE:FREQ=YEARLY;BYMONTH=2;BYDAY=3SU\r\n\
END:STANDARD\r\n\
END:VTIMEZONE\r\n\
{{#matches}}\
BEGIN:VEVENT\r\n\
UID:{{uid}}\r\n\
DTSTAMP:{{date}}\r\n\
DTSTART;TZID=\"America/Sao_Paulo\":{{start}}\r\n\
DTEND;TZID=\"America/Sao_Paulo\":{{end}}\r\n\
SUMMARY:{{summary}}\r\n\
DESCRIPTION:{{description}}\r\n\
LOCATION:{{location}}\r\n\
BEGIN:VALARM\r\n\
ACTION:DISPLAY\r\n\
DESCRIPTION:{{description}}\r\n\
TRIGGER:-PT15M\r\n\
END:VALARM\r\n\
END:VEVENT\r\n\
{{/matches}}\r\n\
END:VCALENDAR");
}


function prepareMatches (serie, matches) {
  return matches.map(function (match) {
    return {
      date: new Date().toISOString().replace(/\-|\:|\.[0-9]{3}/gi, ''),
      uid: crypto.createHash('md5').update(match.home.name + match.guest.name).digest('base64'),
      summary: match.home.name + ' vs ' + match.guest.name,
      description: prepareDescription(serie, match),
      start: prepareDate(new Date(match.datetime)),
      end: prepareDate(new Date(new Date(match.datetime).getTime() + 110 * 60000)),
      location: match.stadium,
    };
  });
}

function prepareDescription (serie, match) {
  return 'Campeonato Brasileiro Série: ' + serie.toUpperCase() + '\\n'
    + 'Rodada: ' + match.round + '\\n'
    + 'Jogo: ' + match.home.name + ' vs ' + match.guest.name + '\\n'
    + 'Estádio: ' + match.stadium;
}

function prepareDate (date) {
  return date.getFullYear()
      .toString()
      .concat(addZeroIfNeeded(date.getMonth() + 1))
      .concat(addZeroIfNeeded(date.getDate()))
      .concat('T')
      .concat(addZeroIfNeeded(date.getHours()))
      .concat(addZeroIfNeeded(date.getMinutes()))
      .concat(addZeroIfNeeded(date.getSeconds()));
}

function addZeroIfNeeded (value) {
  var string = value.toString();
  if (string.length == 2) {
    return string;
  }

  return '0' + string;
}


function validate (data) {
  if (!data.serie || ['a', 'b'].indexOf(data.serie.toLowerCase()) === -1)  {
    return false;
  }

  if (!data.team) {
    return false;
  }

  return true;
}


var template = getTemplate();


function generateIcal (serie, team, championship) {
  return template({
    serie: serie.toUpperCase(),
    team: team,
    matches: prepareMatches(
      serie,
      filterMatchesWithDateAndTime(
        grabTeamMatches(championship.rounds, team)
      )
    ),
  });
}

function fetchChampionshipAndGenerateIcal (serie, team) {
  return fetchChampionship(serie)
    .then(generateIcal.bind(null, serie, team));
}

function generateFilename (serie, team) {
  return 'campeonato-brasileiro-'
    + serie.toLowerCase()
    + '-jogos-'
    + team.split(' ').join('-').toLowerCase()
    + '.ical';
}


module.exports = function (context, req, res) {
  var serie = context.data.serie;
  var team = context.data.team
  if (!validate({ serie: serie, team: team })) {
    res.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'});

    return res.end('You must pass query string: team and serie (a or b)');
  }

  fetchChampionshipAndGenerateIcal(serie, team)
    .then(function (ical) {
      res.writeHead(200, {
        'Content-Type': 'application/force-download',
        'Content-disposition':'attachment; filename=' + generateFilename(serie, team),
      });
      res.end(ical);
    })
    .catch(function (error) {
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