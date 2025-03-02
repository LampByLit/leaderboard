const fs = require('fs');
const path = require('path');

// Read the blacklist file
try {
    const blacklistContent = fs.readFileSync('blacklist.json', 'utf8');
    console.log('Read blacklist.json successfully');
    
    // Write to volume
    const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data';
    const targetPath = path.join(volumePath, 'blacklist.json');
    
    fs.writeFileSync(targetPath, blacklistContent);
    console.log(`Successfully wrote blacklist.json to ${targetPath}`);
    
    // Verify
    console.log('File content:');
    console.log(blacklistContent);
} catch (error) {
    console.error('Error:', error.message);
} 