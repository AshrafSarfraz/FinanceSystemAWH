// config/westwalkAccounts.js

const westwalkAccounts = [
    41112, 44131, 44132, 41111, 44133, 44105, 64114,
    61101, 61103, 61104, 61105, 61106, 61115, 61116,
    64101, 64105, 64121, 54109, 64115, 64102, 64106,
    64111, 64112, 64129, 64203, 64209, 62202, 62205,
    44130, 44128, 44104, 44107, 44122, 44124, 44125,
    55101, 55301, 55201, 51105, 51110, 44137, 44136,
    44140, 64117, 62106, 62110, 62121, 62119, 62207,
    62101, 62104
  ];
  
  // fast lookup
  const westwalkAccountSet = new Set(westwalkAccounts.map(Number));
  
  module.exports = {
    westwalkAccounts,
    westwalkAccountSet
  };
  