const powershellQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

function buildEncodedHelperCommand({ relauncher, installer, application, parentProcessId, statusFile }) {
  const helperCommand = `& ${powershellQuote(relauncher)} -Installer ${powershellQuote(installer)} -Application ${powershellQuote(application)} -ParentProcessId ${parentProcessId} -StatusFile ${powershellQuote(statusFile)}`;
  return Buffer.from(helperCommand, 'utf16le').toString('base64');
}

function parseUpdaterStatus(contents) {
  return JSON.parse(String(contents).replace(/^\uFEFF/, ''));
}

module.exports = { buildEncodedHelperCommand, parseUpdaterStatus };
