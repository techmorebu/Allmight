const { ethers } = require("ethers");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");

async function sendProtectedTransaction(transactionDetails, provider, wallet) {
    const flashbotsProvider = await FlashbotsBundleProvider.create(provider, wallet);

    try {
        const signedTransaction = await wallet.signTransaction(transactionDetails);

        const response = await flashbotsProvider.sendBundle(
            [{ signedTransaction }],
            ethers.provider.getBlockNumber()
        );

        if ("error" in response) {
            console.error("Flashbots error:", response.error.message);
        } else {
            console.log("Protected transaction sent successfully!");
        }
    } catch (error) {
        console.error("Error with protected transaction:", error);
    }
}

module.exports = {
    sendProtectedTransaction
};
